import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArguments } from '../dataveil-mcp-proxy/src/proxy.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { detectHarness, harnesses, runConfigure, runStatus } from '../dataveil-mcp-proxy/src/configure.js';
import { loadSettings, settingsPath, resolveConnection, validateSettings } from '../dataveil-mcp-proxy/src/settings.js';

const script = fileURLToPath(new URL('../dataveil-mcp-proxy/src/index.js', import.meta.url));
const backend = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url));
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'dataveil-shared-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, settingsFile: join(cwd, 'shared.json') };
}
function ui(values, before = () => {}) {
  const take = async (title, choices) => { before(title, choices); assert.ok(values.length, title); return values.shift(); };
  return { input: take, select: take };
}
const create = (mode = 'redact') => ['Confirm', 'Other database / custom MCP', 'Installed stdio MCP executable', process.execPath, JSON.stringify([backend]), mode, 'database', 'Save'];
const nativePath = (opts, harness) => join(opts.cwd, `${harness.key}.${harness.format === 'toml' ? 'toml' : 'json'}`);

async function connect(server, cwd) {
  const transport = new StdioClientTransport({ ...server, env: { ...process.env, DATAVEIL_PII_MODE: undefined }, cwd, stderr: 'pipe' });
  const client = new Client({ name: 'multi-harness-test', version: '1' });
  await client.connect(transport); return client;
}

test('detects harness environment and requires confirmation before any file prompt', async (t) => {
  const opts = fixture(t);
  for (const [env, expected] of [
    [{ CODEX_THREAD_ID: 'synthetic' }, 'codex'], [{ TERM_PROGRAM: 'cursor' }, 'cursor'],
    [{ TERM_PROGRAM: 'windsurf' }, 'windsurf'], [{ TERM_PROGRAM: 'vscode' }, 'vscode'],
    [{ VSCODE_PID: '123' }, 'vscode'], [{ OPENCODE: '1', TERM_PROGRAM: 'vscode' }, 'opencode'], [{ OPENCODE_PID: '123' }, 'opencode'], [{ CODEX_THREAD_ID: 'synthetic', TERM_PROGRAM: 'vscode' }, 'codex'],
  ]) {
    assert.equal(detectHarness(env), expected);
    let prompts = 0;
    const result = await runConfigure(null, { ...opts, env, ui: ui([undefined], (title, choices) => {
      prompts++; assert.match(title, /\(detected\)\?/); assert.deepEqual(choices, ['Confirm', 'Choose another harness']);
    }) });
    assert.equal(prompts, 1); assert.equal(result.status, 'cancelled'); assert.equal(existsSync(opts.settingsFile), false);
  }
  assert.equal(detectHarness({ CODEX_HOME: '/tmp/example' }), null);
});

test('user can reject detected harness, pick another, or cancel at the fallback chooser', async (t) => {
  const opts = fixture(t);
  const result = await runConfigure(null, { ...opts, env: { CODEX_THREAD_ID: 'synthetic' }, configPath: join(opts.cwd, 'cursor.json'), ui: ui(['Choose another harness', 'Cursor', ...create().slice(1)]) });
  assert.equal(result.harnessKey, 'cursor');
  const source = readFileSync(opts.settingsFile, 'utf8');
  assert.equal((await runConfigure(null, { ...opts, env: { CODEX_THREAD_ID: 'synthetic' }, ui: ui(['Choose another harness', undefined]) })).status, 'cancelled');
  assert.equal(readFileSync(opts.settingsFile, 'utf8'), source);
});

test('every harness registration is saved and reuses the same connection without backend prompts', async (t) => {
  const opts = fixture(t);
  const saved = [];
  for (const harness of harnesses) {
    const configPath = nativePath(opts, harness);
    const values = saved.length ? ['Confirm', 'database', 'database', 'Save'] : create();
    saved.push(await runConfigure(harness.key, { ...opts, configPath, ui: ui(values) }));
  }
  const shared = loadSettings(opts.settingsFile);
  assert.equal(Object.keys(shared.connections).length, 1);
  assert.equal(shared.harnesses.length, harnesses.length);
  for (const result of saved) {
    assert.equal(result.settingsFile, opts.settingsFile);
    assert.deepEqual((result.harnessKey === 'opencode' ? result.server.command.slice(2) : result.server.args.slice(1)), ['--connection', 'database', '--settings', opts.settingsFile]);
    assert.equal(existsSync(result.configPath), true);
    assert.ok(shared.harnesses.some((entry) => entry.harnessKey === result.harnessKey && entry.configPath === result.configPath));
  }
  assert.equal(statSync(opts.settingsFile).mode & 0o777, 0o600);
  const status = await runStatus({ ...opts, ui: {}, env: {} });
  for (const harness of harnesses) assert.ok(status.includes(nativePath(opts, harness)));
  assert.equal((status.match(/shared connection database/g) ?? []).length, harnesses.length);
  assert.match(status, /shared connection database/);
});

test('two simultaneous clients from Codex and VS Code launchers read shared policy and remain independent', { timeout: 15000 }, async (t) => {
  const opts = fixture(t);
  const codex = await runConfigure('codex', { ...opts, configPath: join(opts.cwd, 'config.toml'), ui: ui(create()) });
  const vscode = await runConfigure('vscode', { ...opts, configPath: join(opts.cwd, 'vscode.json'), ui: ui(['Confirm', 'database', 'database', 'Save']) });
  const clients = await Promise.all([connect(codex.server, opts.cwd), connect(vscode.server, opts.cwd)]);
  try {
    for (const client of clients) assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'query'));
    for (const result of await Promise.all(clients.map((client) => client.callTool({ name: 'query', arguments: {} })))) {
      assert.match(JSON.stringify(result), /REDACTED/); assert.equal(JSON.stringify(result).includes('alice@example.com'), false);
    }
    await clients[0].close();
    assert.match(JSON.stringify(await clients[1].callTool({ name: 'query', arguments: {} })), /REDACTED/);
  } finally { await Promise.all(clients.map((client) => client.close())); }
  // Changing shared policy doesn't require rewriting either harness file.
  const files = [codex.configPath, vscode.configPath].map((path) => readFileSync(path, 'utf8'));
  const shared = loadSettings(opts.settingsFile); shared.connections.database.mode = 'block';
  writeFileSync(opts.settingsFile, JSON.stringify(shared));
  const restarted = await Promise.all([connect(codex.server, opts.cwd), connect(vscode.server, opts.cwd)]);
  try {
    for (const result of await Promise.all(restarted.map((client) => client.callTool({ name: 'query', arguments: {} })))) {
      assert.equal(result.isError, true); assert.match(JSON.stringify(result), /DATAVEIL_BLOCKED/); assert.equal(JSON.stringify(result).includes('alice@example.com'), false);
    }
  } finally { await Promise.all(restarted.map((client) => client.close())); }
  assert.deepEqual([codex.configPath, vscode.configPath].map((path) => readFileSync(path, 'utf8')), files);
});

test('registering another harness never overwrites earlier native configs or saved registration', async (t) => {
  const opts = fixture(t);
  const first = await runConfigure('cursor', { ...opts, configPath: join(opts.cwd, 'cursor.json'), ui: ui(create()) });
  const bytes = readFileSync(first.configPath, 'utf8');
  await runConfigure('codex', { ...opts, configPath: join(opts.cwd, 'config.toml'), ui: ui(['Confirm', 'database', 'codex_database', 'Save']) });
  assert.equal(readFileSync(first.configPath, 'utf8'), bytes);
  const config = loadSettings(opts.settingsFile);
  assert.equal(config.harnesses.length, 2); assert.equal(config.harnesses[1].connection, 'database');
});

test('cancelled reuse, malformed settings and concurrent shared edits never save a native entry', async (t) => {
  const opts = fixture(t);
  await runConfigure('cursor', { ...opts, configPath: join(opts.cwd, 'cursor.json'), ui: ui(create()) });
  const configPath = join(opts.cwd, 'vscode.json');
  const bytes = readFileSync(opts.settingsFile, 'utf8');
  for (const values of [['Confirm', undefined], ['Confirm', 'database', undefined], ['Confirm', 'database', 'database', undefined]]) {
    assert.equal((await runConfigure('vscode', { ...opts, configPath, ui: ui(values) })).status, 'cancelled');
    assert.equal(readFileSync(opts.settingsFile, 'utf8'), bytes); assert.equal(existsSync(configPath), false);
  }
  await assert.rejects(runConfigure('vscode', { ...opts, configPath, ui: ui(['Confirm', 'database', 'database', 'Save'], (title) => {
    if (title.startsWith('Save ')) { const config = loadSettings(opts.settingsFile); config.connections.database.mode = 'block'; writeFileSync(opts.settingsFile, JSON.stringify(config)); }
  }) }), /changed during setup/);
  assert.equal(existsSync(configPath), false);
  writeFileSync(opts.settingsFile, '{');
  await assert.rejects(runConfigure('vscode', { ...opts, configPath, ui: ui(['Confirm']) }), /Malformed JSON/);
  assert.equal(existsSync(configPath), false); assert.equal(readFileSync(opts.settingsFile, 'utf8'), '{');
});

test('failed native save rolls back shared config exactly; active lock refuses another writer', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permission failure fixture');
  const opts = fixture(t);
  const original = '{ "version": 1, "connections": {}, "harnesses": [] }\n';
  writeFileSync(opts.settingsFile, original);
  const parent = join(opts.cwd, 'parent'); mkdirSync(parent);
  const configPath = join(parent, 'mcp.json');
  await assert.rejects(runConfigure('generic', { ...opts, configPath, ui: ui(create(), (title) => {
    if (title.startsWith('Save ')) chmodSync(parent, 0o500);
  }) }));
  chmodSync(parent, 0o700);
  assert.equal(readFileSync(opts.settingsFile, 'utf8'), original);
  writeFileSync(`${opts.settingsFile}.lock`, '');
  await assert.rejects(runConfigure('generic', { ...opts, configPath: join(opts.cwd, 'another.json'), ui: ui(create()) }), /Another DataVeil setup/);
  assert.equal(readFileSync(opts.settingsFile, 'utf8'), original);
  assert.equal(existsSync(join(opts.cwd, 'another.json')), false);
});

test('CLI rejects unknown/malformed shared connections and incompatible backend options without MCP output', (t) => {
  const opts = fixture(t);
  writeFileSync(opts.settingsFile, JSON.stringify({ version: 1, connections: {}, harnesses: [] }));
  for (const args of [
    ['--connection', 'missing', '--settings', opts.settingsFile], ['--settings', opts.settingsFile],
    ['--connection', 'missing', '--command', process.execPath], ['--connection', 'missing', '--gateway'],
    ['--connection', 'missing', '--arg', 'backend-arg'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { input: '', encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.equal(result.stdout, '');
  }
});


test('shared mode defaults and CLI/environment overrides remain explicit', async (t) => {
  const opts = fixture(t);
  await runConfigure('generic', { ...opts, configPath: join(opts.cwd, 'native.json'), ui: ui(create('block')) });
  const args = ['--connection', 'database', '--settings', opts.settingsFile];
  const resolved = (argv, env = {}) => resolveConnection(parseArguments(argv, env), argv, env);
  assert.equal(resolved(args).mode, 'block');
  assert.equal(resolved([...args, '--mode', 'redact']).mode, 'redact');
  assert.equal(resolved(args, { DATAVEIL_PII_MODE: 'redact' }).mode, 'redact');
  assert.equal(resolved([...args, '--mode', 'block'], { DATAVEIL_PII_MODE: 'redact' }).mode, 'block');
  assert.equal(resolved(['--connection', 'database'], { DATAVEIL_CONFIG_FILE: opts.settingsFile }).mode, 'block');
  assert.throws(() => resolved(['--connection']), /requires a value/);
  assert.throws(() => resolved(['--connection', 'database', '--settings']), /requires a value/);
  assert.throws(() => resolved(args, { DATAVEIL_PII_MODE: 'bad' }), /PII mode/);
  assert.equal(settingsPath({ DATAVEIL_CONFIG_FILE: opts.settingsFile }), opts.settingsFile);
  if (process.platform !== 'win32') assert.equal(settingsPath({ XDG_CONFIG_HOME: opts.cwd }), join(opts.cwd, 'dataveil', 'config.json'));
});

test('invalid shared schemas cannot weaken protection or silently drop registrations', () => {
  for (const value of [
    {}, { version: 2, connections: {}, harnesses: [] },
    { version: 1, connections: { demo: { command: 'node', args: [], mode: 'bad' } }, harnesses: [] },
    { version: 1, connections: { demo: { command: 'node', args: [1], mode: 'redact' } }, harnesses: [] },
    { version: 1, connections: {}, harnesses: [{ harnessKey: 'codex', configPath: '/tmp/config.toml', name: 'demo', connection: 'missing' }] },
    { version: 1, connections: { demo: { command: 'node', args: [], mode: 'redact' } }, harnesses: [{ harnessKey: 'codex', configPath: '/tmp/config.toml', connection: 'demo' }] },
  ]) assert.throws(() => validateSettings(value));
});

test('parallel setup writers detect a changed snapshot and retain the winning registration', async (t) => {
  const opts = fixture(t);
  const results = await Promise.allSettled([
    runConfigure('cursor', { ...opts, configPath: join(opts.cwd, 'cursor.json'), ui: ui(create()) }),
    runConfigure('codex', { ...opts, configPath: join(opts.cwd, 'config.toml'), ui: ui(create()) }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.match(results.find((result) => result.status === 'rejected').reason.message, /changed during setup/);
  const shared = loadSettings(opts.settingsFile);
  assert.equal(shared.harnesses.length, 1);
  assert.ok(existsSync(shared.harnesses[0].configPath));
  assert.equal(existsSync(`${opts.settingsFile}.lock`), false);
});
