import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function installPacked(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'dataveil-package-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const pack = spawnSync('npm', ['pack', '--workspace', '@dataveil/mcp-proxy', '--pack-destination', cwd, '--json'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(pack.error, undefined); assert.equal(pack.status, 0, pack.stderr);
  const info = JSON.parse(pack.stdout)[0];
  for (const path of ['src/index.js', 'src/configure.js', 'src/settings.js', 'src/proxy.js', 'src/gateway.js', 'src/redact.js', 'src/profiles.js', 'README.md']) assert.ok(info.files.some((f) => f.path === path), path);
  const install = spawnSync('npm', ['install', '--prefix', cwd, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(cwd, info.filename)], { cwd, encoding: 'utf8', timeout: 30000 });
  assert.equal(install.error, undefined); assert.equal(install.status, 0, install.stderr);
  return { cwd, scriptPath: join(cwd, 'node_modules', '@dataveil', 'mcp-proxy', 'src', 'index.js') };
}
