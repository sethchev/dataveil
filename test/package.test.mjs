import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { installPacked } from './support/packed.mjs';

test('local packed install runs all binary aliases outside checkout; gateway alias defaults to gateway', (t) => {
  const { cwd } = installPacked(t);
  for (const name of ['dataveil', 'dataveil-mcp-proxy', 'dataveil-gateway']) {
    const bin = join(cwd, 'node_modules', '.bin', name);
    assert.ok(existsSync(bin));
    const help = spawnSync(bin, ['--help'], { cwd, encoding: 'utf8', timeout: 10000 });
    assert.equal(help.error, undefined); assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /dataveil setup/);
  }
  const profiles = join(cwd, 'profiles.json');
  writeFileSync(profiles, '{"connections":{}}');
  const gateway = spawnSync(join(cwd, 'node_modules', '.bin', 'dataveil-gateway'), [], {
    cwd, env: { ...process.env, DATAVEIL_PROFILES_FILE: profiles }, encoding: 'utf8', timeout: 10000,
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n'
  });
  assert.equal(gateway.error, undefined); assert.equal(gateway.status, 0, gateway.stderr);
  assert.equal(JSON.parse(gateway.stdout).result.serverInfo.name, 'dataveil-gateway');
  const metadata = JSON.parse(readFileSync(join(cwd, 'node_modules', '@dataveil', 'mcp-proxy', 'package.json')));
  assert.equal(metadata.license, 'UNLICENSED');
});
