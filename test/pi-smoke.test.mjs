import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('installed Pi loads the real extension and exposes its command through RPC', { skip: !process.env.DATAVEIL_PI_SMOKE, timeout: 20000 }, async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'dataveil-pi-smoke-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const agentDir = join(cwd, 'agent'); mkdirSync(agentDir);
  const child = spawn(process.env.DATAVEIL_PI_BIN || 'pi', ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--extension', fileURLToPath(new URL('../extensions/dataveil.ts', import.meta.url))], {
    cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, stdio: ['pipe', 'pipe', 'pipe']
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  let output = '', stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  const response = new Promise((done, reject) => {
    child.on('error', reject);
    child.on('exit', () => reject(new Error(`Pi exited before command response: ${stderr}`)));
    child.stdout.on('data', (data) => {
      output += data;
      for (const line of output.split('\n').slice(0, -1)) {
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.command === 'get_commands') done(message);
      }
    });
  });
  child.stdin.write('{"type":"get_commands","id":"smoke"}\n');
  const message = await response;
  assert.equal(message.success, true, stderr);
  assert.ok(message.data.commands.some((c) => c.name === 'dataveil' && c.source === 'extension'), JSON.stringify(message));
  assert.equal(/Failed to load extension|Extension error/i.test(stderr), false, stderr);
  child.stdin.end();
  await new Promise((done) => child.once('exit', done));
});
