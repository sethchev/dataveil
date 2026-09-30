import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { copyFileSync } from 'node:fs';
import { runConfigure } from '../dataveil-mcp-proxy/src/configure.js';
import { installPacked } from './support/packed.mjs';

const fake = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url));

test('official SDK launches generated packed config outside repository and discovers/calls tools in redact and block modes', { timeout: 30000 }, async (t) => {
  const { cwd, scriptPath } = installPacked(t);
  // Copy fixture too, so no executable or fixture path depends on the checkout.
  const backend = join(cwd, 'fake.mjs');
  copyFileSync(fake, backend);
  for (const mode of ['redact', 'block']) {
    const answers = ['Custom stdio MCP backend', process.execPath, JSON.stringify([backend]), mode, 'demo', 'Save'];
    const take = async (title) => title.startsWith('Configure ') ? 'Confirm' : title === 'Shared DataVeil connection' ? 'Add a new connection' : title.startsWith('Replace shared connection') ? 'Replace' : answers.shift();
    const result = await runConfigure('generic', { cwd, scriptPath, settingsFile: join(cwd, 'shared.json'), configPath: join(cwd, `mcp-${mode}.json`), ui: { input: take, select: take } });
    const transport = new StdioClientTransport({ command: result.server.command, args: result.server.args, env: { ...process.env, ...result.server.env }, cwd, stderr: 'pipe' });
    const client = new Client({ name: 'dataveil-independent-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion().name, 'fake-mcp-server');
      const listed = await client.listTools();
      const tool = listed.tools.find((tool) => tool.name === 'query');
      assert.equal(tool.description, 'Run a database query; contact support@example.com');
      assert.deepEqual(tool.annotations, { readOnlyHint: true });
      assert.deepEqual(tool.inputSchema, { type: 'object', properties: {} });
      const result = await client.callTool({ name: 'query', arguments: {} });
      const encoded = JSON.stringify(result);
      for (const secret of ['Alice', 'alice@example.com', '555-123-4567']) assert.equal(encoded.includes(secret), false, secret);
      if (mode === 'redact') {
        assert.match(encoded, /REDACTED/);
        assert.equal(result.structuredContent.table_name, 'demo');
        assert.equal(result.structuredContent.EMAIL, '[REDACTED_PII]');
      } else {
        assert.equal(result.isError, true);
        assert.match(encoded, /DATAVEIL_BLOCKED/);
      }
    } finally { await client.close(); }
  }
});
