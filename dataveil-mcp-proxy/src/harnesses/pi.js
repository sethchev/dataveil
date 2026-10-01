import { join } from 'node:path';
import { homedir } from 'node:os';
import { definition, validateRoot, validateLauncher } from './common.js';

export const pi = {
  ...definition('pi', 'Pi', (cwd) => [join(homedir(), '.pi', 'agent', 'mcp.json'), join(cwd, '.pi', 'mcp.json')]),
  validate(config) {
    validateRoot(config, 'mcpServers');
    for (const [name, server] of Object.entries(config.mcpServers ?? {})) validateLauncher(server, name);
  },
};
