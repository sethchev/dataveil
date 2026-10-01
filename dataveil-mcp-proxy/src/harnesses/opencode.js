import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseJsonc, modify, applyEdits } from 'jsonc-parser';
import { definition, validateRoot, object, own } from './common.js';

export const opencode = {
  ...definition('opencode', 'OpenCode', (cwd, env = process.env) => [
    ...(env.OPENCODE_CONFIG ? [resolve(cwd, env.OPENCODE_CONFIG)] : []),
    ...['opencode.json', 'opencode.jsonc'].map((name) => join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode', name)),
    join(cwd, 'opencode.json'), join(cwd, 'opencode.jsonc'),
  ], 'mcp', 'jsonc'),
  validate(config) {
    validateRoot(config, 'mcp');
    for (const [name, server] of Object.entries(config.mcp ?? {})) {
      if (!object(server)) throw new Error(`Invalid server entry: ${name}`);
      if (server.enabled !== undefined && typeof server.enabled !== 'boolean') throw new Error(`Invalid enabled flag: ${name}`);
      if (server.type === undefined && Object.keys(server).every((key) => key === 'enabled') && own(server, 'enabled')) continue;
      if (!['local', 'remote'].includes(server.type)) throw new Error(`Invalid OpenCode server type: ${name}`);
      if (server.type === 'local' && (!Array.isArray(server.command) || !server.command.length || server.command.some((arg) => typeof arg !== 'string') || !server.command[0].trim())) throw new Error(`Invalid command array: ${name}`);
      if (server.type === 'remote' && (typeof server.url !== 'string' || !server.url.trim())) throw new Error(`Missing remote URL: ${name}`);
      if (server.environment !== undefined && (!object(server.environment) || Object.values(server.environment).some((value) => typeof value !== 'string'))) throw new Error(`Invalid environment: ${name}`);
      if (server.args !== undefined || server.env !== undefined) throw new Error(`Wrong OpenCode launcher schema: ${name}`);
    }
  },
  createEntry: ({ command, args }) => ({ type: 'local', command: [command, ...args], enabled: true }),
  normalize: (entry) => ({ ...entry, command: Array.isArray(entry.command) ? entry.command[0] : undefined,
    args: Array.isArray(entry.command) ? entry.command.slice(1) : [], env: entry.environment }),
  parse(source) {
    const errors = [];
    const config = parseJsonc(source, errors, { allowTrailingComma: true });
    if (errors.length) throw new Error('Invalid JSONC');
    return config;
  },
  serialize(config, original) {
    let source = original ?? '{}\n';
    const previous = this.parse(source).mcp ?? {};
    // Edit only changed entries, preserving unrelated settings and comments.
    for (const [name, entry] of Object.entries(config.mcp ?? {})) {
      if (JSON.stringify(previous[name]) === JSON.stringify(entry)) continue;
      source = applyEdits(source, modify(source, ['mcp', name], entry, {
        formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
      }));
    }
    return source;
  },
};
