import { existsSync } from 'node:fs';
export const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export function definition(key, label, paths, field = 'mcpServers', format = 'json') {
  return {
    key, label, field, paths, format,
    detect: (cwd = process.cwd()) => paths(cwd).find(existsSync) ?? null,
    configPath: (cwd = process.cwd()) => paths(cwd)[0] ?? null,
    getServers: (cfg) => cfg[field] ?? {},
    setServers: (cfg, servers) => ({ ...cfg, [field]: servers }),
  };
}

export function validateRoot(config, field) {
  if (!object(config)) throw new Error('Config must be an object');
  if (own(config, field) && !object(config[field])) throw new Error(`${field} must be an object`);
  for (const other of ['mcpServers', 'servers', 'mcp_servers', 'mcp'].filter((key) => key !== field)) {
    if (own(config, other)) throw new Error(`Wrong MCP schema: expected ${field}, not ${other}`);
  }
}
export function validateLauncher(server, name) {
  if (!object(server)) throw new Error(`Invalid server entry: ${name}`);
  if (server.command !== undefined && (typeof server.command !== 'string' || !server.command.trim())) throw new Error(`Invalid command: ${name}`);
  if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string'))) throw new Error(`Invalid args: ${name}`);
  if (server.env !== undefined && (!object(server.env) || Object.values(server.env).some((value) => typeof value !== 'string'))) throw new Error(`Invalid env: ${name}`);
  if (!server.command && typeof server.url !== 'string' && typeof server.serverUrl !== 'string') throw new Error(`Missing command or URL: ${name}`);
}
