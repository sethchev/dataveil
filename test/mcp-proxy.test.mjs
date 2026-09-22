import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { redactSensitiveText, sanitizeValue } from '../dataveil-mcp-proxy/src/redact.js';
import { createStderrSanitizer, discoverCommand, parseArguments, sanitizeServerMessage } from '../dataveil-mcp-proxy/src/proxy.js';

const here = dirname(fileURLToPath(import.meta.url));
const proxy = join(here, '..', 'dataveil-mcp-proxy', 'src', 'index.js');
const fakeServer = join(here, 'fixtures', 'fake-mcp-server.mjs');
const hangingServer = join(here, 'fixtures', 'hanging-mcp-server.mjs');

test('redacts pattern-based, sensitive-column, multiline, and numeric PII', () => {
  const input = '"FIRST_NAME","EMAIL","NOTES"\n"Alice","alice@example.com","line one\nline two"';
  const result = redactSensitiveText(input);
  assert.equal(result.value.includes('Alice'), false);
  assert.equal(result.value.includes('alice@example.com'), false);
  assert.equal(result.value.includes('line one\nline two'), true);
  assert.match(result.value, /\[REDACTED_PII\]/);

  const structured = sanitizeValue({ table_name: 'EMPLOYEES', version: '26.2.2.0', ssn: 123456789 });
  assert.deepEqual(structured.value, { table_name: 'EMPLOYEES', version: '26.2.2.0', ssn: '[REDACTED_PII]' });
  assert.equal(structured.matches, 1);
});

test('redacts IP addresses without mistaking software versions for PII', () => {
  const result = redactSensitiveText('client=192.0.2.10 version=26.2.2.0.0');
  assert.equal(result.value, 'client=[REDACTED_IP] version=26.2.2.0.0');
});

test('recursively redacts JSON embedded in tool text', () => {
  const result = redactSensitiveText('Result: {"customer":{"email":"alice@example.com","ssn":"123-45-6789"}}');
  assert.equal(result.value, 'Result: {"customer":{"email":"[REDACTED_PII]","ssn":"[REDACTED_PII]"}}');
  assert.equal(result.matches, 2);
});

test('preserves JSON-RPC envelopes and metadata while sanitizing only tool-call payloads', () => {
  const pendingRequests = new Map([
    ['string:"alice@example.com"', 'tools/call'],
    ['number:1', 'tools/list'],
    ['string:"1"', 'tools/call']
  ]);
  const metadata = { jsonrpc: '2.0', id: 1, result: { description: 'support@example.com' } };
  assert.strictEqual(sanitizeServerMessage(metadata, { mode: 'redact', pendingRequests }).value, metadata);

  const response = { jsonrpc: '2.0', id: 'alice@example.com', result: { content: [{ type: 'text', text: 'alice@example.com' }] } };
  const sanitized = sanitizeServerMessage(response, { mode: 'redact', pendingRequests }).value;
  assert.equal(sanitized.id, 'alice@example.com');
  assert.equal(sanitized.result.content[0].text, '[REDACTED_EMAIL]');

  const serverRequest = { jsonrpc: '2.0', id: '1', method: 'sampling/createMessage', params: {} };
  assert.strictEqual(sanitizeServerMessage(serverRequest, { mode: 'block', pendingRequests }).value, serverRequest);
  const blocked = sanitizeServerMessage({ jsonrpc: '2.0', id: '1', result: { email: 'person@example.com' } }, { mode: 'block', pendingRequests }).value;
  assert.equal(blocked.result.isError, true);
  assert.match(blocked.result.content[0].text, /DATAVEIL_BLOCKED/);
  assert.match(blocked.result.content[0].text, /MCP backend/);
});

test('buffers backend stderr so PII split across chunks is still redacted', () => {
  let output = '';
  const sanitizer = createStderrSanitizer((text) => { output += text; });
  sanitizer.push(Buffer.from('contact alice@exam'));
  sanitizer.push(Buffer.from('ple.com now\n'));
  sanitizer.end();
  assert.equal(output.includes('alice@example.com'), false);
  assert.match(output, /\[REDACTED_EMAIL\]/);
});

test('rejects invalid configuration instead of weakening it', () => {
  assert.throws(() => parseArguments([], { DATAVEIL_PII_MODE: 'blok' }), /PII mode/);
  assert.throws(() => parseArguments([], { DATAVEIL_MAX_MESSAGE_BYTES: 'large' }), /max-message-bytes/);
  assert.throws(() => parseArguments(['--command'], {}), /requires a value/);
  assert.throws(() => parseArguments(['--backend-timeout-ms', '99'], {}), /backend-timeout-ms/);
  assert.equal(parseArguments(['--gateway'], {}).mode, 'block');
  assert.equal(parseArguments(['--gateway', '--mode', 'redact'], {}).mode, 'redact');
  assert.equal(discoverCommand('/definitely/not-an-executable', { PATH: '' }), null);
});

test('fails closed when the backend does not respond before the timeout', async () => {
  const child = spawn(process.execPath, [
    proxy,
    '--command', process.execPath,
    '--arg', hangingServer,
    '--backend-timeout-ms', '100'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query' } })}\n`);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });

  assert.equal(exitCode, 1);
  assert.match(stderr, /did not respond within 100 ms/);
});

test('connects to a named profile and proxies backend tools through the gateway', async () => {
  const profileDir = await mkdtemp(join(tmpdir(), 'dataveil-gateway-'));
  const profiles = join(profileDir, 'profiles.json');
  await writeFile(profiles, JSON.stringify({ connections: { fake: { command: process.execPath, args: [fakeServer], connectTool: 'connect' } } }));
  const child = spawn(process.execPath, [proxy, '--gateway', '--max-message-bytes', '1024'], {
    env: { ...process.env, DATAVEIL_PROFILES_FILE: profiles, DATAVEIL_PII_MODE: 'redact' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  const messages = [];
  const waiting = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const resolve = waiting.shift();
      if (resolve) resolve(message);
      else messages.push(message);
    }
  });
  const nextMessage = () => messages.length > 0
    ? Promise.resolve(messages.shift())
    : new Promise((resolve) => waiting.push(resolve));
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal((await nextMessage()).result.serverInfo.name, 'dataveil-gateway');
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal((await nextMessage()).result.tools.some((tool) => tool.name === 'dataveil_connect'), true);
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dataveil_connect', arguments: { name: 'fake' } } });
  const connectNotification = await nextMessage();
  const connectResponse = await nextMessage();
  assert.equal(connectNotification.method, 'notifications/tools/list_changed');
  assert.equal(connectResponse.result.isError, undefined);
  send({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} });
  assert.equal((await nextMessage()).result.tools.some((tool) => tool.name === 'query'), true);
  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'dataveil_status', arguments: {} } });
  const status = await nextMessage();
  assert.equal(status.result.structuredContent.connected, true);
  assert.equal(status.result.structuredContent.protected, true);
  send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'query', arguments: {} } });
  const result = await nextMessage();
  const text = result.result.content[0].text;
  assert.equal(text.includes('alice@example.com'), false);
  assert.match(text, /REDACTED/);
  send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'query', arguments: { oversized: true } } });
  const failure = await nextMessage();
  assert.equal(failure.id, 7);
  assert.equal(failure.result.isError, true);
  assert.match(failure.result.content[0].text, /exceeded 1024 bytes/);
  send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'dataveil_status', arguments: {} } });
  assert.equal((await nextMessage()).result.structuredContent.connected, false);
  child.stdin.end();
  await new Promise((resolve) => child.once('exit', resolve));
  await rm(profileDir, { recursive: true, force: true });
});

test('acts as a transparent database-agnostic MCP server while sanitizing tool results', async () => {
  const child = spawn(process.execPath, [
    proxy,
    '--command', process.execPath,
    '--arg', fakeServer
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const requests = [
    { jsonrpc: '2.0', id: 'alice@example.com', method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name: 'query', arguments: {} } }
  ];
  child.stdin.end(requests.map((request) => JSON.stringify(request)).join('\n') + '\n');

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });

  assert.equal(exitCode, 0, stderr);
  const responses = stdout.trim().split('\n').map(JSON.parse);
  assert.equal(responses[0].id, 'alice@example.com');
  assert.equal(responses[0].result.serverInfo.name, 'fake-mcp-server');
  assert.equal(responses[1].result.tools[0].description, 'Run a database query; contact support@example.com');
  const toolText = responses[2].result.content[0].text;
  assert.equal(toolText.includes('Alice'), false);
  assert.equal(toolText.includes('alice@example.com'), false);
  assert.equal(toolText.includes('555-123-4567'), false);
  assert.equal(toolText.includes('[REDACTED_'), true);
  assert.match(stderr, /\[dataveil\] redacted/);
});
