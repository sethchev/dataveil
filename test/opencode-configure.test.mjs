import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { detectHarness, harnesses, runConfigure, runStatus } from '../dataveil-mcp-proxy/src/configure.js';

const adapter = harnesses.find((h) => h.key === 'opencode');
const backend = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url));
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'dataveil-opencode-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, configPath: join(cwd, 'opencode.jsonc'), settingsFile: join(cwd, 'shared.json') };
}
function ui(values) {
  const take = async (title) => { assert.ok(values.length, title); return values.shift(); };
  return { input: take, select: take };
}
const responses = () => ['Confirm', 'Other database / custom MCP', 'Installed stdio MCP executable', process.execPath, JSON.stringify([backend]), 'redact', 'database', 'Save'];
const original = `{
  // Keep model and existing integrations untouched.
  "model": "example/model",
  "mcp": {
    // Existing local server comment.
    "other": { "type": "local", "command": ["existing", "arg"], "environment": {"TOKEN": "{env:TOKEN}"}, },
    "remote": { "type": "remote", "url": "https://example.invalid/mcp" },
    "inherited": { "enabled": false },
  },
}\n`;

test('OpenCode paths and session detection support explicit confirmation', async (t) => {
  const opts = fixture(t);
  assert.deepEqual(adapter.paths(opts.cwd, { XDG_CONFIG_HOME: '/tmp/config', OPENCODE_CONFIG: 'custom.jsonc' }), [
    join(opts.cwd, 'custom.jsonc'), '/tmp/config/opencode/opencode.json', '/tmp/config/opencode/opencode.jsonc',
    join(opts.cwd, 'opencode.json'), join(opts.cwd, 'opencode.jsonc'),
  ]);
  assert.equal(adapter.paths(opts.cwd, {})[0], join(homedir(), '.config', 'opencode', 'opencode.json'));
  assert.equal(detectHarness({ OPENCODE: '1', VSCODE_PID: '1' }), 'opencode');
  assert.equal(detectHarness({ OPENCODE_CONFIG: '/tmp/config' }), null);
  assert.equal((await runConfigure(null, { ...opts, env: { OPENCODE: '1' }, ui: ui([undefined]) })).status, 'cancelled');
  assert.deepEqual(readdirSync(opts.cwd), []);
});

test('OpenCode saves native command arrays, preserves JSONC comments, and reports shared policy', async (t) => {
  const opts = fixture(t); writeFileSync(opts.configPath, original);
  const result = await runConfigure('opencode', { ...opts, ui: ui(responses()) });
  const source = readFileSync(opts.configPath, 'utf8');
  const saved = adapter.parse(source);
  assert.deepEqual(saved.mcp.database, result.server);
  assert.deepEqual(saved.mcp.other, adapter.parse(original).mcp.other);
  assert.equal(saved.model, 'example/model');
  assert.ok(source.includes('// Keep model and existing integrations untouched.'));
  assert.ok(source.includes('// Existing local server comment.'));
  assert.equal(readFileSync(result.backupPath, 'utf8'), original);
  assert.deepEqual(result.server.command.slice(2), ['--connection', 'database', '--settings', opts.settingsFile]);
  assert.equal(result.server.type, 'local'); assert.equal(result.server.enabled, true);
  assert.match(await runStatus({ ...opts, harnessKey: 'opencode', ui: {} }), /database: DataVeil configured; redact mode; shared connection database/);
  saved.mcp.database.enabled = false;
  writeFileSync(opts.configPath, JSON.stringify(saved));
  assert.match(await runStatus({ ...opts, harnessKey: 'opencode', ui: {} }), /MCP entry disabled/);
});

test('OpenCode malformed schemas and cancelled replacement leave existing files untouched', async (t) => {
  const opts = fixture(t);
  for (const source of ['{"mcp":', '{"mcp":[]}', '{"mcpServers":{}}', '{"mcp":{"bad":{"type":"local","command":"node"}}}', '{"mcp":{"bad":{"type":"local","command":[]}}}', '{"mcp":{"bad":{"type":"remote"}}}']) {
    writeFileSync(opts.configPath, source);
    await assert.rejects(runConfigure('opencode', { ...opts, ui: ui(['Confirm']) }));
    assert.equal(readFileSync(opts.configPath, 'utf8'), source);
    assert.deepEqual(readdirSync(opts.cwd), ['opencode.jsonc']);
  }
  writeFileSync(opts.configPath, original);
  for (let i = 0; i < responses().length; i++) {
    assert.equal((await runConfigure('opencode', { ...opts, ui: ui([...responses().slice(0, i), undefined]) })).status, 'cancelled');
    assert.equal(readFileSync(opts.configPath, 'utf8'), original);
  }
  const values = responses(); const entryIndex = values.indexOf('database'); values[entryIndex] = 'other'; values.splice(entryIndex + 1, 0, 'Keep existing (cancel)');
  assert.equal((await runConfigure('opencode', { ...opts, ui: ui(values) })).status, 'cancelled');
  assert.equal(readFileSync(opts.configPath, 'utf8'), original);
});

test('OpenCode generated launcher connects through the proxy and redacts MCP results', { timeout: 10000 }, async (t) => {
  const opts = fixture(t);
  const result = await runConfigure('opencode', { ...opts, ui: ui(responses()) });
  const transport = new StdioClientTransport({ ...adapter.normalize(result.server), cwd: opts.cwd, env: { ...process.env, DATAVEIL_PII_MODE: undefined }, stderr: 'pipe' });
  const client = new Client({ name: 'opencode-launcher-test', version: '1' });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'query'));
    const output = JSON.stringify(await client.callTool({ name: 'query', arguments: {} }));
    assert.match(output, /REDACTED/); assert.equal(output.includes('alice@example.com'), false);
  } finally { await client.close(); }
});

test('installed OpenCode accepts the generated config and connects to DataVeil', { skip: !process.env.DATAVEIL_OPENCODE_SMOKE, timeout: 30000 }, async (t) => {
  const opts = fixture(t);
  await runConfigure('opencode', { ...opts, ui: ui(responses()) });
  const check = spawnSync(process.env.DATAVEIL_OPENCODE_BIN || 'opencode', ['mcp', 'list'], {
    cwd: opts.cwd, timeout: 20000, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: opts.cwd, XDG_CONFIG_HOME: join(opts.cwd, 'config'), XDG_DATA_HOME: join(opts.cwd, 'data'), XDG_CACHE_HOME: join(opts.cwd, 'cache'), XDG_STATE_HOME: join(opts.cwd, 'state'), OPENCODE_CONFIG: opts.configPath, OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_MODELS_FETCH: '1' },
  });
  assert.equal(check.error, undefined); assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /database/); assert.match(check.stdout, /connected/);
});
