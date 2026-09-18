#!/usr/bin/env node
import { parseArguments, runProxy } from './proxy.js';

function usage() {
  return `DataVeil SQLcl MCP privacy proxy

Usage: dataveil-sqlcl-mcp-proxy [options]

Options:
  --sqlcl PATH              SQLcl executable (auto-discovered by default)
  --sqlcl-arg ARG           Child argument; repeat as needed (default: -mcp)
  --mode redact|block       Redact fields or block sensitive tool results
  --max-message-bytes N     Maximum MCP JSON message size (default: 16777216)
  --help                    Show this help

Environment:
  DATAVEIL_SQLCL            Preferred SQLcl executable
  SECURE_ORACLE_SQLCL       Backward-compatible SQLcl executable
  DATAVEIL_PII_MODE         redact (default) or block
`;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
  } else {
    runProxy(options);
  }
} catch (error) {
  process.stderr.write(`[dataveil] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
