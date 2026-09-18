import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { sanitizeValue, redactSensitiveText } from './redact.js';

const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const STDERR_LIMIT_BYTES = 1024 * 1024;

function executableOnPath(command) {
  if (command.includes('/') && existsSync(command)) return command;
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
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

export function discoverSqlcl(explicitPath) {
  return [
    explicitPath,
    process.env.DATAVEIL_SQLCL,
    process.env.SECURE_ORACLE_SQLCL,
    executableOnPath('sql'),
    downloadedSqlcl()
  ].find((candidate) => typeof candidate === 'string' && candidate.length > 0) ?? null;
}

export function parseArguments(argv, env = process.env) {
  const configuredMode = env.DATAVEIL_PII_MODE ?? 'redact';
  const options = {
    sqlcl: null,
    sqlclArgs: [],
    mode: configuredMode,
    maxMessageBytes: env.DATAVEIL_MAX_MESSAGE_BYTES === undefined
      ? DEFAULT_MAX_MESSAGE_BYTES
      : Number(env.DATAVEIL_MAX_MESSAGE_BYTES)
  };
  const nextValue = (index, argument) => {
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${argument} requires a value`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--sqlcl') options.sqlcl = nextValue(index++, argument);
    else if (argument === '--sqlcl-arg') options.sqlclArgs.push(nextValue(index++, argument));
    else if (argument === '--mode') options.mode = nextValue(index++, argument);
    else if (argument === '--max-message-bytes') options.maxMessageBytes = Number(nextValue(index++, argument));
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  if (!['redact', 'block'].includes(options.mode)) {
    throw new Error('PII mode must be "redact" or "block"');
  }
  if (!Number.isSafeInteger(options.maxMessageBytes) || options.maxMessageBytes < 1024) {
    throw new Error('--max-message-bytes must be an integer of at least 1024');
  }
  if (options.sqlclArgs.length === 0) options.sqlclArgs.push('-mcp');
  return options;
}

function requestKey(id) {
  return `${typeof id}:${JSON.stringify(id)}`;
}

function blockedToolResult(categories) {
  return {
    content: [{
      type: 'text',
      text: `[DATAVEIL_BLOCKED] SQLcl returned sensitive data (${categories.join(', ')}). The result was withheld locally.`
    }],
    isError: true
  };
}

export function sanitizeServerMessage(message, context = {}) {
  if (!message || typeof message !== 'object') return { value: message, matches: 0, categories: [] };
  const isResponse = message.id !== undefined && message.method === undefined;
  const method = isResponse ? context.pendingRequests?.get(requestKey(message.id)) : undefined;
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

function createLineProcessor({ maxBytes, onMessage, onError }) {
  let buffer = Buffer.alloc(0);
  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > maxBytes && buffer.indexOf(10) === -1) {
        onError(new Error(`MCP message exceeded ${maxBytes} bytes`));
        buffer = Buffer.alloc(0);
        return;
      }
      let newline;
      while ((newline = buffer.indexOf(10)) !== -1) {
        const line = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
        buffer = buffer.subarray(newline + 1);
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > maxBytes) {
          onError(new Error(`MCP message exceeded ${maxBytes} bytes`));
          continue;
        }
        try {
          onMessage(JSON.parse(line));
        } catch {
          onError(new Error('SQLcl emitted non-JSON data on its MCP stdout; refusing to forward it'));
        }
      }
    },
    end() {
      if (buffer.toString('utf8').trim()) {
        onError(new Error('SQLcl MCP stdout ended with an incomplete JSON message'));
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
        write('[dataveil] SQLcl stderr line withheld because it exceeded the privacy buffer limit\n');
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
  const sqlcl = discoverSqlcl(options.sqlcl);
  if (!sqlcl) throw new Error('Could not find SQLcl. Set DATAVEIL_SQLCL or pass --sqlcl /path/to/sql.');

  const child = spawn(sqlcl, options.sqlclArgs, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pendingRequests = new Map();
  let shuttingDown = false;
  let killTimer;

  const stopInput = () => {
    process.stdin.pause();
    process.stdin.removeListener('data', onClientData);
    process.stdin.removeListener('end', onClientEnd);
  };
  const terminate = (signal = 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;
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
        pendingRequests.set(requestKey(message.id), message.method);
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
        pendingRequests.delete(requestKey(message.id));
      }
    }
  });

  const stderr = createStderrSanitizer((text) => process.stderr.write(`[sqlcl] ${text}`));
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
    stopInput();
    if (code && !shuttingDown) {
      process.stderr.write(`[dataveil] SQLcl MCP exited with code ${code}${signal ? ` (${signal})` : ''}\n`);
    }
    process.exitCode = code ?? (signal && !shuttingDown ? 1 : 0);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => terminate(signal));
  }

  return child;
}

export const constants = { DEFAULT_MAX_MESSAGE_BYTES };
