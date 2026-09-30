import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { databaseOptions, backendOptions, discoverSqlcl, runConfigure } from '../dataveil-mcp-proxy/src/configure.js';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'dataveil-database-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return { cwd, configPath: join(cwd, 'mcp.json'), settingsFile: join(cwd, 'shared.json'), env: { PATH: '', HOME: cwd } };
}
function ui(values, before = () => {}) {
  const take = async (title, options) => { before(title, options); assert.ok(values.length, title); return values.shift(); };
  return { input: take, select: take };
}
function script(path, body = '') {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  return path;
}
const saved = (opts) => JSON.parse(readFileSync(opts.settingsFile)).connections.database;

test('database chooser lists Oracle first and lets each other database select an MCP server', async (t) => {
  assert.deepEqual(databaseOptions, ['Oracle SQLcl MCP', 'PostgreSQL', 'MySQL', 'MariaDB', 'SQLite', 'SQL Server', 'Other database / custom MCP']);
  for (const database of databaseOptions.slice(1)) {
    const opts = fixture(t);
    const result = await runConfigure('generic', { ...opts, ui: ui(['Confirm', database, 'Installed stdio MCP executable', process.execPath, '["custom MCP argument"]', 'block', 'database', 'Save'], (title, options) => {
      if (title.startsWith('Which database')) assert.deepEqual(options, databaseOptions);
      if (title.startsWith('Choose a stdio')) { assert.ok(title.includes(database)); assert.deepEqual(options, backendOptions); }
    }) });
    assert.equal(result.status, 'configured');
    assert.deepEqual(saved(opts), { command: process.execPath, args: ['custom MCP argument'], mode: 'block' });
  }
});

test('SQLcl discovery searches environment, PATH, and extracted Downloads installation in order', (t) => {
  const opts = fixture(t);
  const downloaded = script(join(opts.cwd, 'Downloads', 'sqlcl', 'bin', 'sql'));
  const onPath = script(join(opts.cwd, 'path', 'sql'));
  const homeInstall = script(join(opts.cwd, 'install', 'bin', 'sql'));
  const explicit = script(join(opts.cwd, 'explicit-sql'));
  assert.equal(discoverSqlcl(opts.cwd, opts.env), downloaded);
  assert.equal(discoverSqlcl(opts.cwd, { ...opts.env, PATH: join(opts.cwd, 'path') }), onPath);
  assert.equal(discoverSqlcl(opts.cwd, { ...opts.env, PATH: join(opts.cwd, 'path'), SQLCL_HOME: join(opts.cwd, 'install') }), homeInstall);
  assert.equal(discoverSqlcl(opts.cwd, { ...opts.env, DATAVEIL_SQLCL: explicit, SQLCL_HOME: join(opts.cwd, 'install') }), explicit);
  chmodSync(explicit, 0o600);
  assert.equal(discoverSqlcl(opts.cwd, { ...opts.env, DATAVEIL_SQLCL: explicit }), downloaded);
});

test('Oracle automatically uses discovered SQLcl and only asks for saved connection and policy', async (t) => {
  const opts = fixture(t);
  const sql = script(join(opts.cwd, 'Downloads', 'sqlcl', 'bin', 'sql'), 'console.log("connections\\ndemo_connection");');
  const result = await runConfigure('generic', { ...opts, ui: ui(['Confirm', 'Oracle SQLcl MCP', 'demo_connection', 'redact', 'database', 'Save'], (title) => {
    assert.equal(title.includes('executable path'), false);
    assert.equal(title.startsWith('Choose a stdio'), false);
  }) });
  assert.equal(result.status, 'configured');
  assert.deepEqual(saved(opts), { command: sql, args: ['-name', 'demo_connection', '-mcp'], mode: 'redact' });
});

test('Oracle prompts for executable when discovery fails and cancellation never saves', async (t) => {
  const opts = fixture(t);
  assert.equal(discoverSqlcl(opts.cwd, opts.env), null);
  assert.equal((await runConfigure('generic', { ...opts, ui: ui(['Confirm', 'Oracle SQLcl MCP', undefined]) })).status, 'cancelled');
  assert.deepEqual(readdirSync(opts.cwd), []);
  const sql = script(join(opts.cwd, 'manual-sql'));
  await runConfigure('generic', { ...opts, ui: ui(['Confirm', 'Oracle SQLcl MCP', sql, 'No initial connection', 'block', 'database', 'Save']) });
  assert.deepEqual(saved(opts), { command: sql, args: ['-mcp'], mode: 'block' });
});

test('PostgreSQL MCP package choices generate npx and uvx launchers without running them during setup', async (t) => {
  for (const [runner, choice, packageName, prefix] of [
    ['npx', 'MCP package via npx', '@example/postgres-mcp', ['--yes', '@example/postgres-mcp']],
    ['uvx', 'MCP package via uvx', 'example-postgres-mcp', ['example-postgres-mcp']],
  ]) {
    const opts = fixture(t);
    const marker = join(opts.cwd, 'runner-was-executed');
    const path = script(join(opts.cwd, runner), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'unexpected');`);
    await runConfigure('generic', { ...opts, env: { ...opts.env, PATH: opts.cwd }, ui: ui(['Confirm', 'PostgreSQL', choice, packageName, '["--transport","stdio"]', 'redact', 'database', 'Save']) });
    assert.deepEqual(saved(opts), { command: path, args: [...prefix, '--transport', 'stdio'], mode: 'redact' });
    assert.equal(existsSync(marker), false);
  }
});

test('database/backend selection cancellations and invalid package names cannot save configurations', async (t) => {
  for (const values of [['Confirm', undefined], ['Confirm', 'PostgreSQL', undefined], ['Confirm', 'PostgreSQL', 'Installed stdio MCP executable', undefined]]) {
    const opts = fixture(t);
    assert.equal((await runConfigure('generic', { ...opts, ui: ui(values) })).status, 'cancelled');
    assert.deepEqual(readdirSync(opts.cwd), []);
  }
  for (const packageName of ['', '--bad-flag', 'package extra']) {
    const opts = fixture(t); script(join(opts.cwd, 'npx'));
    await assert.rejects(runConfigure('generic', { ...opts, env: { ...opts.env, PATH: opts.cwd }, ui: ui(['Confirm', 'PostgreSQL', 'MCP package via npx', packageName]) }), /single MCP package name/);
    assert.equal(existsSync(opts.configPath), false); assert.equal(existsSync(opts.settingsFile), false);
  }
});
