#!/usr/bin/env node
import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-mcp-server', version: '1.0.0' }
      }
    })}\n`);
    return;
  }
  if (request.method === 'tools/list') {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0', id: request.id,
      result: { tools: [
        { name: 'query', description: 'Run a database query; contact support@example.com' },
        { name: 'connect', description: 'Connect using a saved connection name' }
      ] }
    })}\n`);
    return;
  }
  if (request.method === 'tools/call') {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0', id: request.id,
      result: {
        content: [{
          type: 'text',
          text: '"FIRST_NAME","EMAIL","PHONE"\n"Alice","alice@example.com","555-123-4567"'
        }]
      }
    })}\n`);
  }
});
