#!/usr/bin/env node
import { parseArguments, runProxy } from './proxy.js';

function usage() {
  return `DataVeil MCP privacy proxy

Usage: dataveil-mcp-proxy [options]

Options:
  --command PATH            MCP backend command to launch
  --arg ARG                 Backend argument; repeat as needed
  --mode redact|block       Redact fields or block sensitive tool results
  --max-message-bytes N     Maximum MCP JSON message size (default: 16777216)
  --help                    Show this help

Backward-compatible Oracle SQLcl options:
  --sqlcl PATH              Alias for --command
  --sqlcl-arg ARG           Alias for --arg

Environment:
  DATAVEIL_COMMAND          MCP backend command
  DATAVEIL_PII_MODE         redact (default) or block
  DATAVEIL_SQLCL            Backward-compatible SQLcl command
  SECURE_ORACLE_SQLCL       Backward-compatible SQLcl command

If no backend arguments are provided and SQLcl is discovered through the
backward-compatible SQLcl path, DataVeil adds -mcp automatically.
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
