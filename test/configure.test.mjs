import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { executable, nodeExecutable, harnesses, runConfigure, runStatus, formatStatusText } from '../dataveil-mcp-proxy/src/configure.js';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'dataveil-config-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, configPath: join(cwd, 'mcp.json'), settingsFile: join(cwd, 'shared.json') };
}
function answers(values, before = () => {}) {
  const take = async (title, options) => { before(title, options); if (title.startsWith('Configure ')) return 'Confirm'; assert.ok(values.length, `Unexpected prompt: ${title}`); return values.shift(); };
  return { input: take, select: take };
}
const custom = (name = 'database') => ['Other database / custom MCP', 'Installed stdio MCP executable', process.execPath, '["arbitrary arg", "--flag"]', 'redact', name, 'Save'];

for (const harness of harnesses.filter((h) => h.format === 'json')) {
  test(`${harness.key}: correct schema, override, preservation, secure backup and absolute launcher`, async (t) => {
    const opts = fixture(t);
    const original = JSON.stringify({ unrelated: { value: 1 }, [harness.field]: { other: { command: process.execPath, args: [] } } });
    writeFileSync(opts.configPath, original);
    const result = await runConfigure(harness.key, { ...opts, ui: answers(custom()) });
    assert.equal(result.status, 'configured');
    assert.equal(readFileSync(result.backupPath, 'utf8'), original);
    const config = JSON.parse(readFileSync(opts.configPath));
    assert.deepEqual(config.unrelated, { value: 1 });
    assert.deepEqual(config[harness.field].other, { command: process.execPath, args: [] });
    assert.equal(result.server.command, resolve(process.execPath));
    assert.ok(result.server.args[0].startsWith('/'));
    assert.deepEqual(result.server.args.slice(1), ['--connection', 'database', '--settings', opts.settingsFile]);
    assert.deepEqual(JSON.parse(readFileSync(opts.settingsFile)).connections.database, { command: process.execPath, args: ['arbitrary arg', '--flag'], mode: 'redact' });
    if (harness.key === 'vscode') assert.equal(result.server.type, 'stdio');
    if (process.platform !== 'win32') {
      assert.equal(statSync(opts.configPath).mode & 0o777, 0o600);
      assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
    }
  });
}

test('cancellation at every backend/setup prompt leaves no files', async (t) => {
  for (let index = 0; index < custom().length; index++) {
    const opts = fixture(t);
    const result = await runConfigure('generic', { ...opts, ui: answers([...custom().slice(0, index), undefined]) });
    assert.equal(result.status, 'cancelled');
    assert.deepEqual(readdirSync(opts.cwd), []);
  }
  for (const values of [[undefined], ['Generic', undefined], ['Generic', 'Enter an explicit config path', undefined]]) {
    const opts = fixture(t);
    assert.equal((await runConfigure(null, { cwd: opts.cwd, env: {}, ui: answers(values) })).status, 'cancelled');
    assert.deepEqual(readdirSync(opts.cwd), []);
  }
});

test('duplicates require explicit replacement and cancellation preserves original', async (t) => {
  const opts = fixture(t);
  const original = JSON.stringify({ mcpServers: { database: { command: 'old' } } });
  writeFileSync(opts.configPath, original);
  for (const response of [undefined, 'Keep existing (cancel)']) {
    assert.equal((await runConfigure('generic', { ...opts, ui: answers([...custom().slice(0, -1), response]) })).status, 'cancelled');
    assert.equal(readFileSync(opts.configPath, 'utf8'), original);
  }
  assert.equal((await runConfigure('generic', { ...opts, ui: answers([...custom().slice(0, -1), 'Replace', 'Save']) })).status, 'configured');
});

test('malformed JSON and invalid schemas cannot be overwritten', async (t) => {
  const opts = fixture(t);
  for (const original of ['{', '[]', '{"mcpServers":[]}', '{"servers":{}}', '{"mcpServers":{"bad":{"args":[1],"command":"x"}}}']) {
    writeFileSync(opts.configPath, original);
    await assert.rejects(runConfigure('generic', { ...opts, ui: answers([]) }));
    assert.equal(readFileSync(opts.configPath, 'utf8'), original);
  }
});

test('detects concurrent edits rather than overwriting', async (t) => {
  const opts = fixture(t);
  await assert.rejects(runConfigure('generic', { ...opts, ui: answers(custom(), (title) => {
    if (title.startsWith('Save ')) writeFileSync(opts.configPath, '{"changed":true}');
  }) }), /changed during setup/);
  assert.equal(readFileSync(opts.configPath, 'utf8'), '{"changed":true}');
  assert.equal(readdirSync(opts.cwd).length, 1);
});

test('PATH lookup uses inherited paths, rejects non-executable files and directories', (t) => {
  const { cwd } = fixture(t);
  const path = join(cwd, 'custom-backend');
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, 0o700);
  assert.equal(executable('custom-backend', cwd, { PATH: cwd }), path);
  assert.throws(() => executable('missing', cwd, { PATH: cwd }), /not found/);
  assert.throws(() => executable(cwd), /not found/);
  if (process.platform !== 'win32') { chmodSync(path, 0o600); assert.throws(() => executable(path), /not found/); }
});

test('raw database clients are rejected; SQLcl permits manual punctuation and spaces', async (t) => {
  const opts = fixture(t);
  await assert.rejects(runConfigure('generic', { ...opts, ui: answers(['Other database / custom MCP', 'Installed stdio MCP executable', 'psql']) }), /not a stdio MCP backend/);
  const result = await runConfigure('generic', { ...opts, env: { PATH: '', HOME: opts.cwd, DATAVEIL_SQLCL: process.execPath }, ui: answers(['Oracle SQLcl MCP', 'Type a saved connection name', 'demo: saved connection!', 'block', 'database', 'Save']) });
  assert.deepEqual(JSON.parse(readFileSync(opts.settingsFile)).connections.database.args, ['-name', 'demo: saved connection!', '-mcp']);
});

test('Cline and unverified locations require explicit user path; cancellation never guesses', async (t) => {
  const { cwd } = fixture(t);
  assert.deepEqual(harnesses.find((h) => h.key === 'cline').paths(cwd), []);
  assert.equal((await runConfigure('cline', { cwd, ui: answers([undefined]) })).status, 'cancelled');
  assert.equal(existsSync(join(cwd, '.vscode', 'mcp.json')), false);
});

test('status describes configuration, CLI policy precedence, gateway defaults and disabled entries', async (t) => {
  const opts = fixture(t);
  writeFileSync(opts.configPath, JSON.stringify({ mcpServers: {
    gateway: { command: 'dataveil-gateway' },
    disabled: { command: 'dataveil', args: ['--gateway'], env: { DATAVEIL_ENABLED: 'false' } },
    override: { command: 'dataveil', args: ['--mode', 'block'], env: { DATAVEIL_PII_MODE: 'redact' }, enabled: false },
    raw: { command: 'backend' },
    backendFlags: { command: 'dataveil', args: ['--arg', '--gateway', '--arg', '--mode', '--arg', 'block'] }
  } }));
  const result = await runStatus({ ...opts, harnessKey: 'generic', ui: {} });
  assert.match(result, /gateway: DataVeil configured; block mode/);
  assert.match(result, /protection disabled/);
  assert.match(result, /override: DataVeil configured; block mode; MCP entry disabled/);
  assert.match(result, /backendFlags: DataVeil configured; redact mode/);
  assert.match(result, /not live protection/);
  assert.match(result, /raw: not configured through DataVeil/);
  assert.match(formatStatusText([{ configPath: opts.configPath, config: [] }]), /Invalid config/);
});


test('compiled Bun hosts resolve Node on PATH instead of launching the host binary', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'bun');
  Object.defineProperty(process.versions, 'bun', { configurable: true, value: 'test-host' });
  t.after(() => { if (descriptor) Object.defineProperty(process.versions, 'bun', descriptor); else delete process.versions.bun; });
  assert.equal(nodeExecutable(), executable('node'));
});
