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
import { loadSettings, settingsPath, profilesPath, resolveConnection, validateSettings } from '../dataveil-mcp-proxy/src/settings.js';

const script = fileURLToPath(new URL('../dataveil-mcp-proxy/src/index.js', import.meta.url));
const backend = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url));
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'dataveil-settings-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, settingsFile: join(cwd, 'settings.json') };
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
    [{ CODEX_THREAD_ID: 'synthetic' }, 'codex'], [{ OPENCODE: '1' }, 'opencode'], [{ OPENCODE_PID: '123' }, 'opencode'],
  ]) {
    assert.equal(detectHarness(env), expected);
    let prompts = 0;
    const result = await runConfigure(null, { ...opts, env, ui: ui([undefined], (title, choices) => {
      prompts++; assert.match(title, /\(detected\)\?/); assert.deepEqual(choices, ['Confirm', 'Choose another harness']);
    }) });
    assert.equal(prompts, 1); assert.equal(result.status, 'cancelled'); assert.equal(existsSync(opts.settingsFile), false);
  }
  assert.equal(detectHarness({ TERM_PROGRAM: 'cursor', VSCODE_PID: '123' }), null);
  assert.equal(detectHarness({ CODEX_HOME: '/tmp/example' }), null);
});

test('user can reject detected harness, pick another, or cancel at the fallback chooser', async (t) => {
  const opts = fixture(t);
  const result = await runConfigure(null, { ...opts, env: { CODEX_THREAD_ID: 'synthetic' }, configPath: join(opts.cwd, 'pi.json'), ui: ui(['Choose another harness', 'Pi', ...create().slice(1)]) });
  assert.equal(result.harnessKey, 'pi');
  const source = readFileSync(opts.settingsFile, 'utf8');
  assert.equal((await runConfigure(null, { ...opts, env: { CODEX_THREAD_ID: 'synthetic' }, ui: ui(['Choose another harness', undefined]) })).status, 'cancelled');
  assert.equal(readFileSync(opts.settingsFile, 'utf8'), source);
});

test('default settings and policy stay isolated for Pi, OpenCode and Codex', { timeout: 15000 }, async (t) => {
  const { cwd } = fixture(t);
  const env = { XDG_CONFIG_HOME: join(cwd, 'config'), APPDATA: join(cwd, 'config') };
  const saved = [];
  for (const harness of harnesses) {
    const result = await runConfigure(harness.key, { cwd, env, configPath: nativePath({ cwd }, harness), ui: ui(create()) });
    saved.push(result);
    assert.equal(result.settingsFile, settingsPath(env, harness.key));
    const settings = loadSettings(result.settingsFile);
    assert.equal(settings.harnesses.length, 1);
    assert.equal(settings.harnesses[0].harnessKey, harness.key);
  }
  assert.equal(new Set(saved.map((entry) => entry.settingsFile)).size, 3);
  const original = saved.slice(1).map((entry) => readFileSync(entry.settingsFile, 'utf8'));
  const piSettings = loadSettings(saved[0].settingsFile);
  piSettings.connections.database.mode = 'block';
  writeFileSync(saved[0].settingsFile, JSON.stringify(piSettings));
  assert.deepEqual(saved.slice(1).map((entry) => readFileSync(entry.settingsFile, 'utf8')), original);
  // Exercise each native launcher: only Pi's policy changed.
  for (const result of saved) {
    const harness = harnesses.find((entry) => entry.key === result.harnessKey);
    const client = await connect(harness.normalize ? harness.normalize(result.server) : result.server, cwd);
    try {
      const output = await client.callTool({ name: 'query', arguments: {} });
      assert.equal(JSON.stringify(output).includes('alice@example.com'), false);
      assert.match(JSON.stringify(output), result.harnessKey === 'pi' ? /DATAVEIL_BLOCKED/ : /REDACTED/);
    } finally { await client.close(); }
  }
  const status = await runStatus({ cwd, env, ui: {} });
  for (const result of saved) assert.ok(status.includes(result.configPath));
  assert.match(status, /database: DataVeil configured; block mode/);
  assert.equal((status.match(/database: DataVeil configured; redact mode/g) ?? []).length, 2);
});

test('explicit settings path cannot mix harness registrations', async (t) => {
  const opts = fixture(t);
  const first = await runConfigure('pi', { ...opts, configPath: join(opts.cwd, 'pi.json'), ui: ui(create()) });
  const native = readFileSync(first.configPath, 'utf8');
  const settings = readFileSync(opts.settingsFile, 'utf8');
  await assert.rejects(runConfigure('codex', { ...opts, configPath: join(opts.cwd, 'config.toml'), ui: ui(['Confirm']) }), /requires its own DataVeil settings file/);
  assert.equal(readFileSync(first.configPath, 'utf8'), native);
  assert.equal(readFileSync(opts.settingsFile, 'utf8'), settings);
  assert.equal(existsSync(join(opts.cwd, 'config.toml')), false);
});

test('cancelled reuse, malformed settings and concurrent settings edits never save a native entry', async (t) => {
  const opts = fixture(t);
  await runConfigure('pi', { ...opts, configPath: join(opts.cwd, 'pi.json'), ui: ui(create()) });
  const configPath = join(opts.cwd, 'pi-second.json');
  const bytes = readFileSync(opts.settingsFile, 'utf8');
  for (const values of [['Confirm', undefined], ['Confirm', 'database', undefined], ['Confirm', 'database', 'database', undefined]]) {
    assert.equal((await runConfigure('pi', { ...opts, configPath, ui: ui(values) })).status, 'cancelled');
    assert.equal(readFileSync(opts.settingsFile, 'utf8'), bytes); assert.equal(existsSync(configPath), false);
  }
  await assert.rejects(runConfigure('pi', { ...opts, configPath, ui: ui(['Confirm', 'database', 'database', 'Save'], (title) => {
    if (title.startsWith('Save ')) { const config = loadSettings(opts.settingsFile); config.connections.database.mode = 'block'; writeFileSync(opts.settingsFile, JSON.stringify(config)); }
  }) }), /changed during setup/);
  assert.equal(existsSync(configPath), false);
  writeFileSync(opts.settingsFile, '{');
  await assert.rejects(runConfigure('pi', { ...opts, configPath, ui: ui(['Confirm']) }), /Malformed JSON/);
  assert.equal(existsSync(configPath), false); assert.equal(readFileSync(opts.settingsFile, 'utf8'), '{');
});

test('failed native save rolls back settings exactly; active lock refuses another writer', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permission failure fixture');
  const opts = fixture(t);
  const original = '{ "version": 1, "connections": {}, "harnesses": [] }\n';
  writeFileSync(opts.settingsFile, original);
  const parent = join(opts.cwd, 'parent'); mkdirSync(parent);
  const configPath = join(parent, 'mcp.json');
  await assert.rejects(runConfigure('pi', { ...opts, configPath, ui: ui(create(), (title) => {
    if (title.startsWith('Save ')) chmodSync(parent, 0o500);
  }) }));
  chmodSync(parent, 0o700);
  assert.equal(readFileSync(opts.settingsFile, 'utf8'), original);
  writeFileSync(`${opts.settingsFile}.lock`, '');
  await assert.rejects(runConfigure('pi', { ...opts, configPath: join(opts.cwd, 'another.json'), ui: ui(create()) }), /Another DataVeil setup/);
  assert.equal(readFileSync(opts.settingsFile, 'utf8'), original);
  assert.equal(existsSync(join(opts.cwd, 'another.json')), false);
});

test('CLI rejects unknown/malformed saved connections and incompatible backend options without MCP output', (t) => {
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


test('saved mode defaults and CLI/environment overrides remain explicit', async (t) => {
  const opts = fixture(t);
  await runConfigure('pi', { ...opts, configPath: join(opts.cwd, 'native.json'), ui: ui(create('block')) });
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

test('invalid settings schemas cannot weaken protection or silently drop registrations', () => {
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
    runConfigure('pi', { ...opts, configPath: join(opts.cwd, 'pi.json'), ui: ui(create()) }),
    runConfigure('pi', { ...opts, configPath: join(opts.cwd, 'pi-second.json'), ui: ui(create()) }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.match(results.find((result) => result.status === 'rejected').reason.message, /changed during setup/);
  const shared = loadSettings(opts.settingsFile);
  assert.equal(shared.harnesses.length, 1);
  assert.ok(existsSync(shared.harnesses[0].configPath));
  assert.equal(existsSync(`${opts.settingsFile}.lock`), false);
});

test('gateway profile defaults live beside DataVeil settings and respect overrides', (t) => {
  const { cwd } = fixture(t);
  const env = { XDG_CONFIG_HOME: cwd, APPDATA: cwd };
  for (const harness of harnesses) {
    assert.equal(profilesPath(env, harness.key), join(cwd, 'dataveil', harness.key, 'profiles.json'));
  }
  assert.equal(profilesPath(env), join(cwd, 'dataveil', 'profiles.json'));
  assert.equal(profilesPath({ ...env, DATAVEIL_CONFIG_FILE: join(cwd, 'custom', 'config.json') }, 'pi'), join(cwd, 'custom', 'profiles.json'));
  assert.equal(profilesPath({ ...env, DATAVEIL_PROFILES_FILE: join(cwd, 'explicit.json') }, 'pi'), join(cwd, 'explicit.json'));
});
