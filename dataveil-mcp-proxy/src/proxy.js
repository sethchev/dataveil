import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { sanitizeValue, redactSensitiveText } from './redact.js';

const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const DEFAULT_BACKEND_TIMEOUT_MS = 120_000;
const STDERR_LIMIT_BYTES = 1024 * 1024;

function isExecutable(path) {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableOnPath(command, env = process.env) {
  if (command.includes('/') && isExecutable(command)) return command;
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function resolveCommand(candidate, env = process.env) {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  return candidate.includes('/') ? (isExecutable(candidate) ? candidate : null) : executableOnPath(candidate, env);
}

function downloadedSqlcl() {
  const downloads = join(homedir(), 'Downloads');
  if (!existsSync(downloads)) return null;
  return readdirSync(downloads)
    .filter((name) => /^sqlcl-/i.test(name))
    .sort()
    .reverse()
    .map((name) => join(downloads, name, 'sqlcl', 'bin', 'sql'))
    .find(existsSync) ?? null;
}

export function discoverCommand(explicitPath, env = process.env) {
  if (explicitPath !== undefined && explicitPath !== null) return resolveCommand(explicitPath, env);
  if (env.DATAVEIL_COMMAND !== undefined) return resolveCommand(env.DATAVEIL_COMMAND, env);
  return [
    env.DATAVEIL_SQLCL,
    env.SECURE_ORACLE_SQLCL,
    executableOnPath('sql', env),
    downloadedSqlcl()
  ].map((candidate) => resolveCommand(candidate, env)).find((candidate) => candidate !== null) ?? null;
}

function usesSqlclDefault(command, env = process.env) {
  return !command && !env.DATAVEIL_COMMAND && (env.DATAVEIL_SQLCL || env.SECURE_ORACLE_SQLCL || executableOnPath('sql', env) || downloadedSqlcl());
}

// Backward-compatible Oracle-specific name.
export const discoverSqlcl = discoverCommand;

export function parseArguments(argv, env = process.env) {
  const configuredMode = env.DATAVEIL_PII_MODE ?? 'redact';
  const options = {
    command: null,
    commandArgs: [],
    gateway: false,
    sqlclCompatibility: false,
    mode: configuredMode,
    maxMessageBytes: env.DATAVEIL_MAX_MESSAGE_BYTES === undefined
      ? DEFAULT_MAX_MESSAGE_BYTES
      : Number(env.DATAVEIL_MAX_MESSAGE_BYTES),
    backendTimeoutMs: env.DATAVEIL_BACKEND_TIMEOUT_MS === undefined
      ? DEFAULT_BACKEND_TIMEOUT_MS
      : Number(env.DATAVEIL_BACKEND_TIMEOUT_MS)
  };
  const nextValue = (index, argument) => {
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${argument} requires a value`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--connection') options.connection = nextValue(index++, argument);
    else if (argument === '--settings') options.settingsFile = nextValue(index++, argument);
    else if (argument === '--command') options.command = nextValue(index++, argument);
    else if (argument === '--sqlcl') {
      options.command = nextValue(index++, argument);
      options.sqlclCompatibility = true;
    } else if (argument === '--arg') options.commandArgs.push(nextValue(index++, argument));
    else if (argument === '--sqlcl-arg') {
      options.commandArgs.push(nextValue(index++, argument));
      options.sqlclCompatibility = true;
    }
    else if (argument === '--mode') options.mode = nextValue(index++, argument);
    else if (argument === '--max-message-bytes') options.maxMessageBytes = Number(nextValue(index++, argument));
    else if (argument === '--backend-timeout-ms') options.backendTimeoutMs = Number(nextValue(index++, argument));
    else if (argument === '--gateway') options.gateway = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (options.gateway && env.DATAVEIL_PII_MODE === undefined && !argv.includes('--mode')) options.mode = 'block';
  if (!['redact', 'block'].includes(options.mode)) {
    throw new Error('PII mode must be "redact" or "block"');
  }
  if (!Number.isSafeInteger(options.maxMessageBytes) || options.maxMessageBytes < 1024) {
    throw new Error('--max-message-bytes must be an integer of at least 1024');
  }
  if (!Number.isSafeInteger(options.backendTimeoutMs) || options.backendTimeoutMs < 100) {
    throw new Error('--backend-timeout-ms must be an integer of at least 100');
  }
  if (options.connection === undefined && options.commandArgs.length === 0 && (options.sqlclCompatibility || usesSqlclDefault(options.command, env))) options.commandArgs.push('-mcp');
  return options;
}

function requestKey(id) {
  return `${typeof id}:${JSON.stringify(id)}`;
}

function pendingMethod(pendingRequests, id) {
  const pending = pendingRequests?.get(requestKey(id));
  if (Array.isArray(pending)) return pending[0]?.method;
  if (typeof pending === 'string') return pending;
  return pending?.method;
}

function blockedToolResult(categories) {
  return {
    content: [{
      type: 'text',
      text: `[DATAVEIL_BLOCKED] The MCP backend returned sensitive data (${categories.join(', ')}). The result was withheld locally.`
    }],
    isError: true
  };
}

export function sanitizeServerMessage(message, context = {}) {
  if (!message || typeof message !== 'object') return { value: message, matches: 0, categories: [] };
  const isResponse = message.id !== undefined && message.method === undefined;
  const method = isResponse ? pendingMethod(context.pendingRequests, message.id) : undefined;
  if (method !== 'tools/call') return { value: message, matches: 0, categories: [] };

  const payloadKey = Object.hasOwn(message, 'result') ? 'result' : Object.hasOwn(message, 'error') ? 'error' : null;
  if (!payloadKey) return { value: message, matches: 0, categories: [] };
  const sanitized = sanitizeValue(message[payloadKey]);
  const payload = sanitized.matches > 0 && context.mode === 'block' && payloadKey === 'result'
    ? blockedToolResult(sanitized.categories)
    : sanitized.value;

  return {
    value: { ...message, [payloadKey]: payload },
    matches: sanitized.matches,
    categories: sanitized.categories
  };
}

export function createLineProcessor({ maxBytes, onMessage, onError }) {
  let buffer = Buffer.alloc(0);
  let failed = false;
  const fail = (error) => {
    if (failed) return;
    failed = true;
    buffer = Buffer.alloc(0);
    onError(error);
  };
  return {
    push(chunk) {
      if (failed) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > maxBytes && buffer.indexOf(10) === -1) {
        fail(new Error(`MCP message exceeded ${maxBytes} bytes`));
        return;
      }
      let newline;
      while ((newline = buffer.indexOf(10)) !== -1) {
        const line = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
        buffer = buffer.subarray(newline + 1);
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > maxBytes) {
          fail(new Error(`MCP message exceeded ${maxBytes} bytes`));
          return;
        }
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          fail(new Error('MCP peer emitted non-JSON data on stdout; refusing to forward it'));
          return;
        }
        onMessage(message);
        if (failed) return;
      }
    },
    end() {
      if (!failed && buffer.toString('utf8').trim()) {
        fail(new Error('MCP peer stdout ended with an incomplete JSON message'));
      }
    }
  };
}

function safeDiagnostic(input) {
  return redactSensitiveText(String(input)).value;
}

export function createStderrSanitizer(write) {
  let buffer = '';
  let discarding = false;
  return {
    push(chunk) {
      buffer += chunk.toString('utf8');
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline + 1);
        buffer = buffer.slice(newline + 1);
        if (!discarding) write(safeDiagnostic(line));
        discarding = false;
      }
      if (Buffer.byteLength(buffer) > STDERR_LIMIT_BYTES) {
        write('[dataveil] MCP backend stderr line withheld because it exceeded the privacy buffer limit\n');
        buffer = '';
        discarding = true;
      }
    },
    end() {
      if (buffer && !discarding) write(safeDiagnostic(buffer));
      buffer = '';
    }
  };
}

export function runProxy(options) {
  const command = discoverCommand(options.command);
  if (!command) throw new Error('Could not find an executable MCP backend command. Set DATAVEIL_COMMAND or pass --command /path/to/backend.');

  const child = spawn(command, options.commandArgs, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pendingRequests = new Map();
  let shuttingDown = false;
  let killTimer;

  const stopInput = () => {
    process.stdin.pause();
    process.stdin.removeListener('data', onClientData);
    process.stdin.removeListener('end', onClientEnd);
  };
  const clearPendingRequests = () => {
    for (const entries of pendingRequests.values()) {
      for (const entry of Array.isArray(entries) ? entries : [entries]) {
        if (entry?.timer) clearTimeout(entry.timer);
      }
    }
    pendingRequests.clear();
  };
  const removePendingRequest = (id) => {
    const key = requestKey(id);
    const entries = pendingRequests.get(key);
    if (!entries) return;
    if (!Array.isArray(entries)) {
      pendingRequests.delete(key);
      return;
    }
    const entry = entries.shift();
    if (entry?.timer) clearTimeout(entry.timer);
    if (entries.length === 0) pendingRequests.delete(key);
  };
  const terminate = (signal = 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearPendingRequests();
    stopInput();
    if (!child.killed) child.kill(signal);
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 2000);
    killTimer.unref();
  };
  const failClosed = (error) => {
    process.stderr.write(`[dataveil] ${safeDiagnostic(error.message)}\n`);
    process.exitCode = 1;
    terminate();
  };

  const clientMessages = createLineProcessor({
    maxBytes: options.maxMessageBytes,
    onError: failClosed,
    onMessage(message) {
      if (message && message.id !== undefined && typeof message.method === 'string') {
        const key = requestKey(message.id);
        const entries = pendingRequests.get(key) ?? [];
        const entry = { method: message.method };
        entry.timer = setTimeout(() => {
          failClosed(new Error(`MCP backend did not respond within ${options.backendTimeoutMs} ms`));
        }, options.backendTimeoutMs);
        entries.push(entry);
        pendingRequests.set(key, entries);
      }
      if (!child.stdin.write(`${JSON.stringify(message)}\n`)) {
        process.stdin.pause();
        child.stdin.once('drain', () => { if (!shuttingDown) process.stdin.resume(); });
      }
    }
  });

  const serverMessages = createLineProcessor({
    maxBytes: options.maxMessageBytes,
    onError: failClosed,
    onMessage(message) {
      const result = sanitizeServerMessage(message, { mode: options.mode, pendingRequests });
      if (result.matches > 0) {
        process.stderr.write(`[dataveil] ${options.mode === 'block' ? 'blocked' : 'redacted'} ${result.matches} sensitive value(s): ${result.categories.join(', ')}\n`);
      }
      if (!process.stdout.write(`${JSON.stringify(result.value)}\n`)) {
        child.stdout.pause();
        process.stdout.once('drain', () => { if (!shuttingDown) child.stdout.resume(); });
      }
      if (message && message.id !== undefined && message.method === undefined) {
        removePendingRequest(message.id);
      }
    }
  });

  const stderr = createStderrSanitizer((text) => process.stderr.write(`[mcp-backend] ${text}`));
  function onClientData(chunk) { clientMessages.push(chunk); }
  function onClientEnd() {
    clientMessages.end();
    child.stdin.end();
  }

  process.stdin.on('data', onClientData);
  process.stdin.on('end', onClientEnd);
  process.stdin.on('error', failClosed);
  child.stdin.on('error', (error) => {
    if (!shuttingDown && error.code !== 'EPIPE') failClosed(error);
  });
  child.stdout.on('data', (chunk) => serverMessages.push(chunk));
  child.stdout.on('end', () => serverMessages.end());
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  child.stderr.on('end', () => stderr.end());
  child.on('error', failClosed);
  child.on('exit', (code, signal) => {
    if (killTimer) clearTimeout(killTimer);
    const hadPendingRequests = pendingRequests.size > 0;
    clearPendingRequests();
    stopInput();
    if (hadPendingRequests && !shuttingDown) {
      process.stderr.write('[dataveil] MCP backend exited before responding to all requests\n');
      process.exitCode = 1;
    }
    if (code && !shuttingDown) {
      process.stderr.write(`[dataveil] MCP backend exited with code ${code}${signal ? ` (${signal})` : ''}\n`);
    }
    process.exitCode ??= code ?? (signal && !shuttingDown ? 1 : 0);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => terminate(signal));
  }

  return child;
}

export const constants = { DEFAULT_MAX_MESSAGE_BYTES, DEFAULT_BACKEND_TIMEOUT_MS };
