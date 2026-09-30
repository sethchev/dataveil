import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../dataveil-mcp-proxy/src/index.js', import.meta.url));
const run = (args, input = '') => spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8', timeout: 10000 });

test('help, setup dispatch, alias dispatch, status, missing values and incompatible options', () => {
  assert.match(run(['--help']).stdout, /dataveil setup/);
  for (const args of [['setup', '--harness', 'generic'], ['--configure', '--harness', 'generic']]) {
    const result = run(args); assert.equal(result.status, 1); assert.match(result.stderr, /interactive terminal/); assert.equal(result.stdout, '');
  }
  assert.equal(run(['status', '--harness', 'generic']).status, 0);
  assert.match(run(['status', '--harness', 'generic']).stdout, /not live protection/);
  for (const args of [['setup', '--harness'], ['setup', '--config', '--harness', 'pi'], ['setup', '--harness', 'unknown'], ['status', '--gateway'], ['setup', '--command', 'x'], ['--harness', 'pi'], ['status', '--config', '/tmp/x']]) {
    assert.equal(run(args).status, 1, args.join(' '));
  }
});

test('package entry import has no side effects', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../dataveil-mcp-proxy/src/index.js', import.meta.url).href)}); console.log('imported')`], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, 'imported\n'); assert.equal(result.stderr, '');
});


test('backend argument --configure does not dispatch the setup wizard', () => {
  const fake = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url));
  const result = run(['--command', process.execPath, '--arg', fake, '--arg', '--configure'], JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result.serverInfo.name, 'fake-mcp-server');
});
