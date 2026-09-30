import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';

// Transpile the actual extension; retain ESM URL resolution using its original location.
const url = new URL('../extensions/dataveil.ts', import.meta.url);
const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace("'../dataveil-mcp-proxy/src/configure.js'", JSON.stringify(new URL('../dataveil-mcp-proxy/src/configure.js', import.meta.url).href))
  .replace('import.meta.url', JSON.stringify(url.href));
const { default: extension } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture(t, values = []) {
  const cwd = mkdtempSync(join(tmpdir(), 'dataveil-pi-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const oldConfig = process.env.DATAVEIL_CONFIG_FILE;
  process.env.DATAVEIL_CONFIG_FILE = join(cwd, 'shared.json');
  t.after(() => { if (oldConfig === undefined) delete process.env.DATAVEIL_CONFIG_FILE; else process.env.DATAVEIL_CONFIG_FILE = oldConfig; });
  const commands = new Map(), registrations = [], notifications = [];
  extension({ registerCommand: (name, command) => commands.set(name, command), registerMcpServer: (...args) => registrations.push(args) });
  const take = async () => { assert.ok(values.length); return values.shift(); };
  const ctx = { cwd, hasUI: true, ui: { input: take, select: take, notify: (...args) => notifications.push(args) } };
  return { cwd, ctx, registrations, notifications, commands, run: (action) => commands.get('dataveil').handler(action, ctx) };
}
test('single documented command dispatches; cancelled setup never writes', async (t) => {
  const f = fixture(t, [undefined]);
  assert.deepEqual([...f.commands.keys()], ['dataveil']);
  await f.run('setup');
  assert.match(f.notifications[0][0], /cancelled/);
  assert.equal(existsSync(join(f.cwd, '.pi', 'mcp.json')), false);
  f.ctx.hasUI = false;
  await assert.rejects(f.run('setup'), /require a Pi UI/);
});
test('actual setup handler delegates to shared UI and persists project config', async (t) => {
  const f = fixture(t);
  const path = join(f.cwd, '.pi', 'mcp.json');
  f.ctx.ui.select = async (title) => title.startsWith('Configure ') ? 'Confirm' : title === 'Destination config file' ? path : title.startsWith('Select a stdio') ? 'Custom stdio MCP backend' : title === 'Privacy mode' ? 'redact' : 'Save';
  f.ctx.ui.input = async (title) => title.startsWith('MCP backend executable') ? process.execPath : title.startsWith('Backend arguments') ? '[]' : 'demo';
  await f.run('setup');
  assert.equal(JSON.parse(readFileSync(path)).mcpServers.demo.command, process.execPath);
  assert.match(f.notifications[0][0], /configured/);
  assert.match(f.notifications[0][0], /not been verified/);
  await f.run('status');
  assert.match(f.notifications.at(-1)[0], /DataVeil configured; redact mode/);
});
test('gateway registration uses absolute launcher and profile path, block policy, documented exposure', async (t) => {
  const f = fixture(t);
  await f.run('gateway');
  assert.equal(f.registrations.length, 0);
  writeFileSync(join(f.cwd, 'dataveil-profiles.json'), '{"connections":{}}');
  await f.run('gateway');
  const [name, config] = f.registrations[0];
  assert.equal(name, 'dataveil'); assert.equal(config.command, process.execPath);
  assert.ok(config.args[0].startsWith('/')); assert.equal(config.args[1], '--gateway');
  assert.equal(config.env.DATAVEIL_PII_MODE, 'block'); assert.equal(config.exposure, 'codemode');
  await f.run('unknown'); assert.match(f.notifications.at(-1)[0], /Usage/);
});
