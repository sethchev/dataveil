import { readFileSync, lstatSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve, isAbsolute, dirname } from 'node:path';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const namePattern = /^[A-Za-z0-9_-]+$/;

export function settingsPath(env = process.env, harnessKey) {
  if (env.DATAVEIL_CONFIG_FILE) return resolve(env.DATAVEIL_CONFIG_FILE);
  const base = platform() === 'win32' ? env.APPDATA || join(homedir(), 'AppData', 'Roaming') : env.XDG_CONFIG_HOME || join(homedir(), '.config');
  if (harnessKey && !['pi', 'opencode', 'codex'].includes(harnessKey)) throw new Error(`Unknown harness: ${harnessKey}`);
  return harnessKey ? join(base, 'dataveil', harnessKey, 'config.json') : join(base, 'dataveil', 'config.json');
}

export function profilesPath(env = process.env, harnessKey) {
  return resolve(env.DATAVEIL_PROFILES_FILE ?? join(dirname(settingsPath(env, harnessKey)), 'profiles.json'));
}

export function validateSettings(config) {
  if (!object(config) || config.version !== 1 || !object(config.connections) || !Array.isArray(config.harnesses)) {
    throw new Error('DataVeil settings must contain version: 1, a connections object and a harnesses array');
  }
  for (const [name, connection] of Object.entries(config.connections)) {
    if (!namePattern.test(name) || !object(connection) || typeof connection.command !== 'string' || !connection.command.trim()) throw new Error(`Invalid DataVeil connection: ${name}`);
    if (!Array.isArray(connection.args) || connection.args.some((arg) => typeof arg !== 'string')) throw new Error(`Invalid connection args: ${name}`);
    if (!['redact', 'block'].includes(connection.mode)) throw new Error(`Invalid connection mode: ${name}`);
  }
  const registrations = new Set();
  for (const entry of config.harnesses) {
    if (!object(entry) || typeof entry.harnessKey !== 'string' || !entry.harnessKey || typeof entry.configPath !== 'string' || !isAbsolute(entry.configPath) || typeof entry.name !== 'string' || !namePattern.test(entry.name) || typeof entry.connection !== 'string' || !Object.hasOwn(config.connections, entry.connection)) throw new Error('Invalid DataVeil harness registration');
    const key = JSON.stringify([entry.configPath, entry.name]);
    if (registrations.has(key)) throw new Error('Duplicate DataVeil harness registration');
    registrations.add(key);
  }
}

export function loadSettings(path = settingsPath()) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('DataVeil settings must be a regular file');
  let config;
  try { config = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(`Malformed DataVeil settings: ${path}`); }
  validateSettings(config);
  return config;
}

export function resolveConnection(options, argv, env = process.env) {
  if (options.connection === undefined) {
    if (options.settingsFile !== undefined) throw new Error('--settings requires --connection');
    return options;
  }
  if (options.gateway || options.command !== null || options.commandArgs.length) throw new Error('--connection cannot be combined with --gateway, --command, --sqlcl or backend arguments');
  const path = resolve(options.settingsFile ?? settingsPath(env));
  const config = loadSettings(path);
  if (!Object.hasOwn(config.connections, options.connection)) throw new Error(`Unknown DataVeil connection: ${options.connection}`);
  const connection = config.connections[options.connection];
  return { ...options, command: connection.command, commandArgs: connection.args,
    mode: argv.includes('--mode') || env.DATAVEIL_PII_MODE !== undefined ? options.mode : connection.mode };
}
