import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse, stringify } from 'smol-toml';
import { detectHarness, harnesses, runConfigure, runStatus } from '../dataveil-mcp-proxy/src/configure.js';

const adapter = harnesses.find((h) => h.key === 'codex');
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'dataveil-codex-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, configPath: join(cwd, 'config.toml'), settingsFile: join(cwd, 'settings.json') };
}
function ui(values, before = () => {}) {
  const take = async (title, options) => { before(title, options); if (title.startsWith('Configure ') && !['Choose another harness', undefined].includes(values[0])) return 'Confirm'; assert.ok(values.length, title); return values.shift(); };
  return { input: take, select: take };
}
const responses = (name = 'database') => ['Other database / custom MCP', 'Installed stdio MCP executable', process.execPath, '["arg with spaces", "--flag"]', 'block', name, 'Save'];
const original = `# Existing user settings
model = "example-model"
model_reasoning_effort = "high"
[features]
example_feature = true
[projects."/tmp/example project"]
trust_level = "trusted"
[mcp_servers.existing]
command = "existing-backend"
args = ["keep"]
enabled = false
[mcp_servers.existing.env]
EXAMPLE_SECRET = "\${EXAMPLE_SECRET}"
[mcp_servers.remote]
url = "https://example.invalid/mcp"
`;

test('Codex destination uses global/project TOML locations and respects CODEX_HOME', () => {
  assert.deepEqual(adapter.paths('/tmp/project', {}), [join(homedir(), '.codex', 'config.toml'), '/tmp/project/.codex/config.toml']);
  assert.deepEqual(adapter.paths('/tmp/project', { CODEX_HOME: '/tmp/custom-codex' }), ['/tmp/custom-codex/config.toml', '/tmp/project/.codex/config.toml']);
  assert.equal(detectHarness({ CODEX_THREAD_ID: 'synthetic' }), 'codex');
  assert.equal(detectHarness({ CODEX_SESSION_ID: 'synthetic' }), 'codex');
  assert.equal(detectHarness({ CODEX_HOME: '/tmp/custom-codex' }), null);
  assert.equal(detectHarness({}), null);
});

test('Codex setup preserves unrelated TOML settings/server entries and backs up exact source', async (t) => {
  const opts = fixture(t); writeFileSync(opts.configPath, original);
  const result = await runConfigure('codex', { ...opts, ui: ui(responses()) });
  const saved = parse(readFileSync(opts.configPath, 'utf8'));
  const expected = parse(original); expected.mcp_servers.database = result.server;
  assert.deepEqual(saved, parse(stringify(expected)));
  assert.equal(readFileSync(result.backupPath, 'utf8'), original);
  assert.ok(saved.mcp_servers.database.args[0].startsWith('/'));
  assert.equal(saved.mcp_servers.database.type, undefined);
  if (process.platform !== 'win32') {
    assert.equal(statSync(opts.configPath).mode & 0o777, 0o600);
    assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
  }
  assert.match(await runStatus({ ...opts, harnessKey: 'codex', ui: {} }), /database: DataVeil configured; block mode/);
});

test('Codex session detection still asks for harness selection; explicit selection takes precedence', async (t) => {
  const opts = fixture(t);
  const env = { CODEX_THREAD_ID: 'synthetic', CODEX_HOME: opts.cwd };
  const result = await runConfigure(null, { cwd: opts.cwd, env, settingsFile: opts.settingsFile, ui: ui([opts.configPath, ...responses()]) });
  assert.equal(result.harnessKey, 'codex'); assert.equal(result.configPath, opts.configPath);
  const jsonPath = join(opts.cwd, 'pi.json');
  const explicit = await runConfigure('pi', { cwd: opts.cwd, configPath: jsonPath, settingsFile: join(opts.cwd, 'pi-settings.json'), env, ui: ui(responses()) });
  assert.equal(explicit.harnessKey, 'pi');
  assert.ok(JSON.parse(readFileSync(jsonPath)).mcpServers.database);
  const status = await runStatus({ cwd: opts.cwd, env, settingsFile: opts.settingsFile, harnessKey: 'codex', ui: {} });
  assert.match(status, /database: DataVeil configured/);
});

test('Codex can be selected normally without session markers and chooses project scope', async (t) => {
  const { cwd } = fixture(t);
  const configPath = join(cwd, '.codex', 'config.toml');
  const result = await runConfigure(null, { cwd, env: {}, settingsFile: join(cwd, 'settings.json'), ui: ui(['Codex CLI', configPath, ...responses()]) });
  assert.equal(result.configPath, configPath);
  assert.ok(parse(readFileSync(configPath, 'utf8')).mcp_servers.database);
});

test('Codex malformed TOML and mismatched schemas cannot be overwritten', async (t) => {
  const opts = fixture(t);
  for (const value of ['model = "unterminated', 'model="one"\nmodel="two"', 'mcp_servers = []', '[mcpServers.other]\ncommand="node"', '[servers.other]\ncommand="node"', '[mcp_servers.other]\nargs=[1]\ncommand="node"']) {
    writeFileSync(opts.configPath, value);
    await assert.rejects(runConfigure('codex', { ...opts, ui: ui([]) }));
    assert.equal(readFileSync(opts.configPath, 'utf8'), value);
    assert.deepEqual(readdirSync(opts.cwd), ['config.toml']);
  }
});

test('Codex cancellation at every prompt and declined replacement preserve existing bytes', async (t) => {
  const opts = fixture(t); writeFileSync(opts.configPath, original);
  for (let i = 0; i < responses().length; i++) {
    const result = await runConfigure('codex', { ...opts, ui: ui([...responses().slice(0, i), undefined]) });
    assert.equal(result.status, 'cancelled');
    assert.equal(readFileSync(opts.configPath, 'utf8'), original);
    assert.deepEqual(readdirSync(opts.cwd), ['config.toml']);
  }
  assert.equal((await runConfigure('codex', { ...opts, ui: ui([...responses('existing').slice(0, -1), 'Keep existing (cancel)']) })).status, 'cancelled');
  const result = await runConfigure('codex', { ...opts, ui: ui([...responses('existing').slice(0, -1), 'Replace', 'Save']) });
  const saved = parse(readFileSync(opts.configPath, 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(saved.mcp_servers.existing)), result.server);
  assert.equal(saved.model, 'example-model'); assert.ok(saved.mcp_servers.remote);
});

test('Codex concurrent edits are refused and leave no temporary files', async (t) => {
  const opts = fixture(t); writeFileSync(opts.configPath, original);
  const changed = 'model = "changed"\n';
  await assert.rejects(runConfigure('codex', { ...opts, ui: ui(responses(), (title) => {
    if (title.startsWith('Save ')) writeFileSync(opts.configPath, changed);
  }) }), /changed during setup/);
  assert.equal(readFileSync(opts.configPath, 'utf8'), changed);
  assert.deepEqual(readdirSync(opts.cwd), ['config.toml']);
});

test('installed Codex CLI reads actual generated TOML in isolated CODEX_HOME', async (t) => {
  const binary = process.env.DATAVEIL_CODEX_BIN || 'codex';
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (version.error?.code === 'ENOENT') return t.skip('Codex CLI is not installed');
  assert.equal(version.error, undefined); assert.equal(version.status, 0, version.stderr);
  const opts = fixture(t);
  await runConfigure('codex', { ...opts, ui: ui(responses()) });
  const result = spawnSync(binary, ['mcp', 'get', 'database', '--json'], {
    cwd: opts.cwd, env: { ...process.env, CODEX_HOME: opts.cwd }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.name, 'database');
  assert.equal(config.transport.command, process.execPath);
  assert.deepEqual(config.transport.args.slice(1), ['--connection', 'database', '--settings', opts.settingsFile]);
  assert.equal(JSON.parse(readFileSync(opts.settingsFile)).connections.database.mode, 'block');
});


test('detected Codex session can select another harness or cancel without writing', async (t) => {
  const opts = fixture(t);
  const env = { CODEX_THREAD_ID: 'synthetic' };
  let prompted = false;
  const result = await runConfigure(null, { ...opts, env, ui: ui(['Choose another harness', 'Pi', ...responses()], (title, choices) => {
    if (title.startsWith('Select your agent harness')) { prompted = true; assert.ok(choices.includes('Codex CLI')); }
  }) });
  assert.equal(prompted, true); assert.equal(result.harnessKey, 'pi');
  const original = readFileSync(opts.configPath, 'utf8');
  assert.equal((await runConfigure(null, { ...opts, env, ui: ui([undefined]) })).status, 'cancelled');
  assert.equal(readFileSync(opts.configPath, 'utf8'), original);
});
