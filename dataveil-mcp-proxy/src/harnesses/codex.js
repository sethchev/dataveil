import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse, stringify } from 'smol-toml';
import { definition, validateRoot, validateLauncher } from './common.js';

export const codex = {
  ...definition('codex', 'Codex CLI', (cwd, env = process.env) => [
    join(resolve(env.CODEX_HOME || join(homedir(), '.codex')), 'config.toml'),
    join(cwd, '.codex', 'config.toml'),
  ], 'mcp_servers', 'toml'),
  parse,
  serialize: (config) => stringify(config),
  validate(config) {
    validateRoot(config, 'mcp_servers');
    for (const [name, server] of Object.entries(config.mcp_servers ?? {})) validateLauncher(server, name);
  },
};
