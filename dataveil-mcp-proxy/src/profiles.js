import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { profilesPath } from './settings.js';

const DEFAULT_PROFILES_FILE = profilesPath();

function resolveEnvironment(environment = {}) {
  const output = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== 'string') throw new Error(`Environment value for ${key} must be a string`);
    const match = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u);
    if (match) {
      if (process.env[match[1]] === undefined) throw new Error(`Environment variable ${match[1]} is not set`);
      output[key] = process.env[match[1]];
    } else {
      output[key] = value;
    }
  }
  return output;
}

function validateProfile(name, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Connection profile "${name}" must be an object`);
  if (typeof raw.command !== 'string' || raw.command.length === 0) throw new Error(`Connection profile "${name}" requires a command`);
  if (raw.url || raw.socket) throw new Error(`Connection profile "${name}" must use a local stdio command`);
  if (raw.connectTool !== undefined && (typeof raw.connectTool !== 'string' || raw.connectTool.length === 0)) {
    throw new Error(`Connection profile "${name}" connectTool must be a non-empty string`);
  }
  if (raw.connectArgument !== undefined && (typeof raw.connectArgument !== 'string' || raw.connectArgument.length === 0)) {
    throw new Error(`Connection profile "${name}" connectArgument must be a non-empty string`);
  }
  if (raw.args !== undefined && (!Array.isArray(raw.args) || raw.args.some((arg) => typeof arg !== 'string'))) {
    throw new Error(`Connection profile "${name}" args must be an array of strings`);
  }
  return {
    name,
    command: raw.command,
    args: raw.args ?? [],
    env: resolveEnvironment(raw.env),
    cwd: raw.cwd ? resolve(raw.cwd) : undefined,
    connectTool: raw.connectTool,
    connectArgument: raw.connectArgument ?? 'connection_name',
    description: typeof raw.description === 'string' ? raw.description : undefined
  };
}

export function loadProfiles(env = process.env) {
  const path = profilesPath(env);
  if (!existsSync(path)) throw new Error(`DataVeil profiles file was not found: ${path}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read DataVeil profiles file: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.connections || typeof parsed.connections !== 'object') {
    throw new Error('DataVeil profiles file must contain a connections object');
  }
  const profiles = new Map();
  for (const [name, raw] of Object.entries(parsed.connections)) profiles.set(name, validateProfile(name, raw));
  return { path, profiles };
}

export const defaults = { DEFAULT_PROFILES_FILE };
