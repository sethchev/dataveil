#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runConfigure, runStatus, harnesses } from './configure.js';
import { resolveConnection } from './settings.js';
import { runGateway } from './gateway.js';
import { parseArguments, runProxy } from './proxy.js';

export function usage() {
  return `DataVeil MCP privacy proxy

Usage: dataveil [proxy options]
       dataveil setup [--harness NAME] [--config FILE] [--settings FILE]
       dataveil --configure [--harness NAME] [--config FILE] [--settings FILE]
       dataveil status [--harness NAME] [--config FILE] [--settings FILE]

Setup is interactive. --config overrides the prompted destination.
Harnesses: codex, claude-desktop, cursor, windsurf, vscode, cline, pi, generic.
The dataveil-gateway executable defaults to gateway mode.

Options:
  --connection NAME         Launch a connection from shared DataVeil settings
  --settings FILE           Shared settings file (default: user DataVeil config)
  --command PATH            MCP backend command to launch
  --arg ARG                 Backend argument; repeat as needed
  --mode redact|block       Redact fields or block sensitive tool results
  --max-message-bytes N     Maximum MCP JSON message size (default: 16777216)
  --backend-timeout-ms N    Backend response timeout (default: 120000)
  --gateway                 Run the DataVeil MCP gateway
  --configure               Run the shared interactive setup wizard
  --help                    Show this help

Backward-compatible Oracle SQLcl options:
  --sqlcl PATH              Alias for --command
  --sqlcl-arg ARG           Alias for --arg

Environment:
  DATAVEIL_CONFIG_FILE      Shared DataVeil settings file
  DATAVEIL_COMMAND          MCP backend command
  DATAVEIL_PII_MODE         redact (default) or block
  DATAVEIL_SQLCL            Backward-compatible SQLcl command
  SECURE_ORACLE_SQLCL       Backward-compatible SQLcl command
  DATAVEIL_BACKEND_TIMEOUT_MS  Backend response timeout (default: 120000)
  DATAVEIL_PROFILES_FILE       Named connection profiles file
  DATAVEIL_ENABLED             true (default) or false to disable protection

If no backend arguments are provided and SQLcl is discovered through the
backward-compatible SQLcl path, DataVeil adds -mcp automatically.
`;
}

export async function main(argv = process.argv.slice(2), executableName = process.argv[1]) {
  // Backend argument values can themselves be named --configure.
  const valueOptions = new Set(['--arg', '--sqlcl-arg', '--command', '--sqlcl', '--mode', '--max-message-bytes', '--backend-timeout-ms', '--harness', '--config', '--connection', '--settings']);
  let configureOption = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--configure') configureOption = true;
    else if (valueOptions.has(argv[i])) i++;
  }
  const action = argv[0] === 'setup' || argv[0] === 'status' ? argv[0] : configureOption ? 'setup' : null;
  if (action) {
    const args = argv[0] === action ? argv.slice(1) : argv;
    const options = {};
    let help = false;
    let configure = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--help') help = true;
      else if (arg === '--configure' && action === 'setup' && !configure) configure = true;
      else if (arg === '--harness' || arg === '--config' || arg === '--settings') {
        const value = args[++i];
        if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
        const key = arg === '--harness' ? 'harnessKey' : arg === '--settings' ? 'settingsFile' : 'configPath';
        if (options[key] !== undefined) throw new Error(`Duplicate option: ${arg}`);
        options[key] = value;
      } else throw new Error(`Unknown or incompatible ${action} option: ${arg}`);
    }
    if (options.harnessKey && !harnesses.some((h) => h.key === options.harnessKey)) throw new Error(`Unknown harness: ${options.harnessKey}`);
    if (help) { process.stdout.write(usage()); return; }
    if (action === 'status') return runStatus(options);
    return runConfigure(options.harnessKey, options);
  }
  if (argv.includes('--help') && argv.length === 1) { process.stdout.write(usage()); return; }
  const gatewayAlias = basename(executableName ?? '').replace(/\.(cmd|exe)$/i, '') === 'dataveil-gateway';
  const parsed = parseArguments(gatewayAlias ? ['--gateway', ...argv] : argv);
  const options = parsed.help ? parsed : resolveConnection(parsed, argv);
  if (options.help) process.stdout.write(usage());
  else if (options.gateway) return runGateway(options);
  else return runProxy(options);
}

// Package imports expose functions without starting a server.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`[dataveil] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
