import { spawn } from 'node:child_process';
import { discoverCommand, sanitizeServerMessage, createStderrSanitizer, createLineProcessor } from './proxy.js';
import { loadProfiles } from './profiles.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const CONTROL_TOOLS = [
  {
    name: 'dataveil_connect',
    description: 'Connect DataVeil to a named database MCP connection profile.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Saved DataVeil connection name' } }, required: ['name'] }
  },
  {
    name: 'dataveil_disconnect',
    description: 'Disconnect the active DataVeil database MCP connection.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'dataveil_status',
    description: 'Report DataVeil connection and privacy protection status.',
    inputSchema: { type: 'object', properties: {} }
  }
];

function jsonrpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function toolText(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

export function runGateway(options = {}) {
  const mode = options.mode ?? 'redact';
  const timeoutMs = options.backendTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
  const enabled = !['0', 'false', 'off', 'no'].includes(String((options.env ?? process.env).DATAVEIL_ENABLED ?? 'true').toLowerCase());
  const profileState = loadProfiles(options.env ?? process.env);
  process.stderr.write(`[dataveil] gateway managed=true enabled=${enabled} policy=${enabled ? mode : 'disabled'} timeout_ms=${timeoutMs}\n`);
  let backend = null;
  let activeProfile = null;
  let backendToolMap = new Map();
  let backendRequestId = 0;
  let shuttingDown = false;
  const pendingBackend = new Map();

  const writeClient = (message) => {
    if (!shuttingDown) process.stdout.write(`${JSON.stringify(message)}\n`);
  };
  const safeError = (error) => String(error instanceof Error ? error.message : error).replace(/[\r\n]+/gu, ' ').slice(0, 500);

  const clearPending = (error) => {
    for (const pending of pendingBackend.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    pendingBackend.clear();
  };

  const closeBackend = async (reason = new Error('MCP backend disconnected')) => {
    const child = backend;
    backend = null;
    activeProfile = null;
    backendToolMap = new Map();
    clearPending(reason);
    if (!child) return;
    if (!child.killed) child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); resolve(); }, 2_000);
      timer.unref();
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  };

  const replaceBackendTools = (tools) => {
    if (!Array.isArray(tools)) throw new Error('MCP backend returned an invalid tools/list response');
    for (const tool of CONTROL_TOOLS) {
      if (tools.some((candidate) => candidate.name === tool.name)) throw new Error(`Backend tool conflicts with reserved DataVeil tool: ${tool.name}`);
    }
    backendToolMap = new Map(tools.map((tool) => [tool.name, tool]));
  };
  const refreshBackendTools = async () => {
    try {
      const response = await sendBackendRequest('tools/list');
      replaceBackendTools(response.result?.tools);
      writeClient({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} });
    } catch (error) {
      process.stderr.write(`[dataveil] backend tool refresh failed: ${safeError(error)}\n`);
    }
  };
  const onBackendMessage = (message) => {
    if (message?.method === 'notifications/tools/list_changed') {
      void refreshBackendTools();
      return;
    }
    if (message && message.id !== undefined && message.method === undefined) {
      const key = String(message.id);
      const pending = pendingBackend.get(key);
      if (!pending) return;
      pendingBackend.delete(key);
      clearTimeout(pending.timer);
      pending.resolve(message);
    }
  };

  const failBackend = (error) => {
    process.stderr.write(`[dataveil] ${safeError(error)}\n`);
    void closeBackend(error);
  };

  const sendBackendRequest = (method, params = {}) => new Promise((resolve, reject) => {
    if (!backend || !backend.stdin.writable) return reject(new Error('No database MCP backend is connected'));
    const id = `dataveil-${++backendRequestId}`;
    const timer = setTimeout(() => {
      failBackend(new Error(`MCP backend did not respond within ${timeoutMs} ms`));
    }, timeoutMs);
    pendingBackend.set(String(id), { resolve, reject, timer });
    backend.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  const startBackend = async (profile) => {
    const command = discoverCommand(profile.command, options.env ?? process.env);
    if (!command) throw new Error(`Connection profile "${profile.name}" does not resolve to an executable command`);
    await closeBackend();
    const child = spawn(command, profile.args, {
      cwd: profile.cwd,
      env: { ...process.env, ...profile.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    backend = child;
    const processor = createLineProcessor({ maxBytes, onMessage: onBackendMessage, onError: failBackend });
    child.stdout.on('data', (chunk) => processor.push(chunk));
    child.stdout.on('end', () => processor.end());
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.stderr.on('end', () => stderr.end());
    child.once('error', (error) => clearPending(error));
    child.once('exit', (code) => {
      if (backend === child) {
        backend = null;
        activeProfile = null;
        backendToolMap = new Map();
        clearPending(new Error(`MCP backend exited with code ${code ?? 0}`));
      }
    });
    await sendBackendRequest('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'dataveil-gateway', version: '0.1.0' }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const toolsResponse = await sendBackendRequest('tools/list');
    replaceBackendTools(toolsResponse.result?.tools);
    if (profile.connectTool) {
      if (!backendToolMap.has(profile.connectTool)) throw new Error(`Backend does not expose the configured connection tool: ${profile.connectTool}`);
      const connectionResponse = await sendBackendRequest('tools/call', {
        name: profile.connectTool,
        arguments: { [profile.connectArgument]: profile.name }
      });
      if (connectionResponse.error || connectionResponse.result?.isError) {
        throw new Error(`Backend connection tool failed for ${profile.name}`);
      }
    }
    activeProfile = profile;
  };

  const stderr = createStderrSanitizer((text) => process.stderr.write(`[mcp-backend] ${text}`));
  const status = () => ({
    connected: Boolean(backend && activeProfile),
    connection: activeProfile?.name ?? null,
    backend: activeProfile?.command ?? null,
    enabled,
    protected: enabled && (mode === 'redact' || mode === 'block'),
    policy: enabled ? mode : 'disabled',
    toolCount: backendToolMap.size,
    profilesFile: profileState.path
  });

  const handleCall = async (id, name, args) => {
    if (name === 'dataveil_status') return jsonrpc(id, { ...toolText(JSON.stringify(status())), structuredContent: status() });
    if (name === 'dataveil_disconnect') {
      await closeBackend();
      writeClient({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} });
      return jsonrpc(id, toolText('DataVeil disconnected.'));
    }
    if (name === 'dataveil_connect') {
      const profileName = args?.name;
      const profile = profileState.profiles.get(profileName);
      if (!profile) return jsonrpc(id, toolText(`Unknown DataVeil connection profile: ${String(profileName)}`, true));
      try {
        await startBackend(profile);
        writeClient({ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} });
        return jsonrpc(id, toolText(`DataVeil connected to ${profile.name}; ${backendToolMap.size} backend tool(s) are protected.`));
      } catch (error) {
        await closeBackend();
        return jsonrpc(id, toolText(`DataVeil connection failed: ${safeError(error)}`, true));
      }
    }
    if (!backendToolMap.has(name)) return jsonrpc(id, toolText(`Unknown DataVeil or backend tool: ${name}`, true));
    try {
      const backendId = `dataveil-call-${++backendRequestId}`;
      const timer = setTimeout(() => {
        failBackend(new Error(`MCP backend did not respond within ${timeoutMs} ms`));
      }, timeoutMs);
      const responsePromise = new Promise((resolve, reject) => pendingBackend.set(String(backendId), { resolve, reject, timer }));
      backend.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: backendId, method: 'tools/call', params: { name, arguments: args ?? {} } })}\n`);
      const response = await responsePromise;
      const pendingRequests = new Map([[`${typeof backendId}:${JSON.stringify(backendId)}`, 'tools/call']]);
      const sanitized = enabled
        ? sanitizeServerMessage({ ...response, id: backendId }, { mode, pendingRequests })
        : { value: response, matches: 0, categories: [] };
      return { ...sanitized.value, id };
    } catch (error) {
      return jsonrpc(id, toolText(`DataVeil backend call failed: ${safeError(error)}`, true));
    }
  };

  const toolsList = () => ({ tools: [...CONTROL_TOOLS, ...backendToolMap.values()] });
  const onClientMessage = async (message) => {
    if (!message || typeof message !== 'object') return;
    if (message.method === 'initialize') {
      writeClient(jsonrpc(message.id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'dataveil-gateway', version: '0.1.0' }
      }));
      return;
    }
    if (message.method === 'notifications/initialized') return;
    if (message.method === 'ping') { writeClient(jsonrpc(message.id, {})); return; }
    if (message.method === 'tools/list') { writeClient(jsonrpc(message.id, toolsList())); return; }
    if (message.method === 'tools/call') {
      writeClient(await handleCall(message.id, message.params?.name, message.params?.arguments));
      return;
    }
    if (message.id !== undefined) writeClient({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unsupported MCP method: ${message.method}` } });
  };

  const clientProcessor = createLineProcessor({
    maxBytes,
    onMessage: (message) => { if (!shuttingDown) void onClientMessage(message); },
    onError: (error) => {
      process.stderr.write(`[dataveil] ${safeError(error)}\n`);
      shuttingDown = true;
      process.exitCode = 1;
      process.stdin.pause();
      void closeBackend(error);
    }
  });
  process.stdin.on('data', (chunk) => clientProcessor.push(chunk));
  process.stdin.on('end', async () => { clientProcessor.end(); shuttingDown = true; await closeBackend(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { shuttingDown = true; await closeBackend(); process.exitCode = 0; });
  return { close: closeBackend };
}
