#!/usr/bin/env node
import { constants, existsSync, accessSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, lstatSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { loadSettings, settingsPath, validateSettings } from './settings.js';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { parse as parseJsonc, modify, applyEdits } from 'jsonc-parser';

const defaultScript = fileURLToPath(new URL('./index.js', import.meta.url));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const rawClients = new Set(['psql', 'sqlite3', 'mysql', 'mariadb']);
const commandBase = (command) => basename(command).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');

function definition(key, label, paths, field = 'mcpServers', format = 'json') {
  return {
    key, label, field, paths, format,
    detect: (cwd = process.cwd()) => paths(cwd).find(existsSync) ?? null,
    configPath: (cwd = process.cwd()) => paths(cwd)[0] ?? null,
    getServers: (cfg) => cfg[field] ?? {},
    setServers: (cfg, servers) => ({ ...cfg, [field]: servers }),
  };
}

// OpenCode stores local launchers as a command array and accepts JSONC.
const opencode = {
  ...definition('opencode', 'OpenCode', (cwd, env = process.env) => [
    ...(env.OPENCODE_CONFIG ? [resolve(cwd, env.OPENCODE_CONFIG)] : []),
    ...['opencode.json', 'opencode.jsonc'].map((name) => join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode', name)),
    join(cwd, 'opencode.json'), join(cwd, 'opencode.jsonc'),
  ], 'mcp', 'jsonc'),
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

export const harnesses = [
  opencode,
  definition('codex', 'Codex CLI', (cwd, env = process.env) => [
    join(resolve(env.CODEX_HOME || join(homedir(), '.codex')), 'config.toml'),
    join(cwd, '.codex', 'config.toml'),
  ], 'mcp_servers', 'toml'),
  definition('claude-desktop', 'Claude Desktop', () => platform() === 'darwin'
    ? [join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')]
    : platform() === 'win32'
      ? [join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')]
      : []),
  definition('cursor', 'Cursor', (cwd) => [join(homedir(), '.cursor', 'mcp.json'), join(cwd, '.cursor', 'mcp.json')]),
  // Legacy Windsurf location only when it exists; current vendor paths have changed.
  definition('windsurf', 'Windsurf (explicit path recommended)', () => {
    const legacy = join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
    return existsSync(legacy) ? [legacy] : [];
  }),
  definition('vscode', 'VS Code', (cwd) => [join(cwd, '.vscode', 'mcp.json')], 'servers'),
  // Cline storage depends on the editor, profile and installation. Never guess it.
  definition('cline', 'Cline (explicit config path)', () => []),
  definition('generic', 'Generic', (cwd) => [join(cwd, 'mcp.json')]),
  definition('pi', 'Pi', (cwd) => [join(homedir(), '.pi', 'agent', 'mcp.json'), join(cwd, '.pi', 'mcp.json')]),
];

function validateConfig(config, harness) {
  if (harness.validate) return harness.validate(config);
  if (!object(config)) throw new Error('Config must be an object');
  if (own(config, harness.field) && !object(config[harness.field])) {
    throw new Error(`${harness.field} must be an object`);
  }
  for (const otherField of ['mcpServers', 'servers', 'mcp_servers', 'mcp'].filter((field) => field !== harness.field)) {
    if (own(config, otherField)) throw new Error(`Wrong MCP schema: expected ${harness.field}, not ${otherField}`);
  }
  for (const [name, server] of Object.entries(harness.getServers(config))) {
    if (!object(server)) throw new Error(`Invalid server entry: ${name}`);
    if (harness.key === 'opencode') {
      if (server.enabled !== undefined && typeof server.enabled !== 'boolean') throw new Error(`Invalid enabled flag: ${name}`);
      if (server.type === undefined && Object.keys(server).every((key) => key === 'enabled') && own(server, 'enabled')) continue;
      if (!['local', 'remote'].includes(server.type)) throw new Error(`Invalid OpenCode server type: ${name}`);
      if (server.type === 'local' && (!Array.isArray(server.command) || !server.command.length || server.command.some((arg) => typeof arg !== 'string') || !server.command[0].trim())) throw new Error(`Invalid command array: ${name}`);
      if (server.type === 'remote' && (typeof server.url !== 'string' || !server.url.trim())) throw new Error(`Missing remote URL: ${name}`);
      if (server.environment !== undefined && (!object(server.environment) || Object.values(server.environment).some((value) => typeof value !== 'string'))) throw new Error(`Invalid environment: ${name}`);
      if (server.args !== undefined || server.env !== undefined) throw new Error(`Wrong OpenCode launcher schema: ${name}`);
      continue;
    }
    if (server.command !== undefined && (typeof server.command !== 'string' || !server.command.trim())) throw new Error(`Invalid command: ${name}`);
    if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string'))) throw new Error(`Invalid args: ${name}`);
    if (server.env !== undefined && (!object(server.env) || Object.values(server.env).some((value) => typeof value !== 'string'))) throw new Error(`Invalid env: ${name}`);
    if (!server.command && typeof server.url !== 'string' && typeof server.serverUrl !== 'string') throw new Error(`Missing command or URL: ${name}`);
  }
}

function loadConfig(path, harness) {
  let original = null;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Config must be a regular file, not a symlink');
    original = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let config;
  try { config = original === null ? harness.empty?.() ?? {} : harness.parse ? harness.parse(original) : harness.format === 'toml' ? parseToml(original) : JSON.parse(original); }
  catch { throw new Error(`Malformed ${harness.format === 'toml' ? 'TOML' : harness.format === 'jsonc' ? 'JSONC' : 'JSON'} config: ${path}. Refusing to overwrite it.`); }
  validateConfig(config, harness);
  return { config, original };
}

function atomicSave(path, config, original, harness, source) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${randomUUID()}`;
  let backupPath = null;
  try {
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, source ?? (harness.serialize ? harness.serialize(config, original) : harness.format === 'toml' ? stringifyToml(config) : JSON.stringify(config, null, 2) + '\n')); fsyncSync(fd); }
    finally { closeSync(fd); }
    // Detect edits made while the wizard was open rather than clobbering them.
    if (loadConfig(path, harness).original !== original) throw new Error('Config changed during setup; retry configuration');
    if (original !== null) {
      backupPath = `${path}.bak-${randomUUID()}`;
      writeFileSync(backupPath, original, { flag: 'wx', mode: 0o600 });
    }
    renameSync(temp, path);
    return backupPath;
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

/** Pi-compatible input(title, placeholder?) / select(title, string[]) adapter.
 * EOF, Ctrl-C and Escape cancel, returning undefined, never a default answer.
 */
export function createTerminalUI() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let pending;
  let closed = false;
  rl.on('close', () => { closed = true; pending?.(undefined); pending = undefined; });
  rl.on('SIGINT', () => rl.close());
  const question = (prompt) => new Promise((done) => {
    if (closed) return done(undefined);
    pending = done;
    rl.question(prompt, (answer) => { pending = undefined; done(answer.includes('\x1b') ? undefined : answer.trim()); });
  });
  return {
    input: (title, placeholder = '') => question(`${title}${placeholder ? ` (${placeholder})` : ''}: `),
    async select(title, options) {
      while (!closed) {
        const answer = await question(`${title}\n${options.map((option, i) => `  ${i + 1}. ${option}`).join('\n')}\nEnter number: `);
        if (answer === undefined || answer === '') return undefined;
        if (/^\d+$/.test(answer) && options[Number(answer) - 1] !== undefined) return options[Number(answer) - 1];
      }
      return undefined;
    },
    close: () => rl.close(),
  };
}

export function executable(command, cwd = process.cwd(), env = process.env) {
  const candidates = isAbsolute(command) || command.includes('/') || command.includes('\\')
    ? [resolve(cwd, command)]
    : (env.PATH ?? '').split(delimiter).flatMap((dir) => platform() === 'win32'
      ? [command, ... (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((ext) => command + ext)].map((name) => resolve(cwd, dir, name))
      : [resolve(cwd, dir, command)]);
  for (const candidate of candidates) {
    try { accessSync(candidate, constants.X_OK); if (statSync(candidate).isFile()) return candidate; }
    catch { /* Try next PATH entry. */ }
  }
  throw new Error(`Executable not found: ${command}`);
}

// Pi may be distributed as a compiled Bun executable; that executable cannot
// launch our Node CLI. Resolve Node from inherited PATH in that host.
export function nodeExecutable(cwd = process.cwd()) {
  return process.versions.bun ? executable('node', cwd) : resolve(process.execPath);
}

function savedConnections(command) {
  const result = spawnSync(command, ['-nolog'], { input: 'connmgr list\nexit\n', encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) return [];
  // Only consume name-only rows. Unrecognized SQLcl output is handled by manual input.
  return [...new Set((result.stdout ?? '').split(/\r?\n/).map((line) => line.trim())
    .filter((line) => /^[\w][\w.-]*$/.test(line) && !/^(connections?|name|sql)$/i.test(line)))];
}

export function detectHarness(env = process.env) {
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID) return 'codex';
  if (env.OPENCODE === '1' || env.OPENCODE_PID) return 'opencode';
  const terminal = String(env.TERM_PROGRAM ?? '').toLowerCase();
  if (terminal === 'cursor' || env.CURSOR_TRACE_ID) return 'cursor';
  if (terminal === 'windsurf') return 'windsurf';
  if (terminal === 'vscode' || env.VSCODE_PID) return 'vscode';
  return null;
}

const sharedDefinition = {
  format: 'json', validate: validateSettings,
  empty: () => ({ version: 1, connections: {}, harnesses: [] }),
};

// Serialize setup writers and roll back shared settings if the native write fails.
// All prompts finish before acquiring the lock or modifying either file.
function saveRegistration(sharedPath, sharedConfig, sharedOriginal, path, nativeConfig, nativeOriginal, harness) {
  if (sharedPath === path) throw new Error('Harness config and DataVeil settings must use different files');
  mkdirSync(dirname(sharedPath), { recursive: true });
  const lockPath = `${sharedPath}.lock`;
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another DataVeil setup is saving settings; retry after it finishes');
    throw error;
  }
  let sharedBackupPath;
  try {
    if (loadConfig(sharedPath, sharedDefinition).original !== sharedOriginal || loadConfig(path, harness).original !== nativeOriginal) throw new Error('Config changed during setup; retry configuration');
    sharedBackupPath = atomicSave(sharedPath, sharedConfig, sharedOriginal, sharedDefinition);
    try {
      const backupPath = atomicSave(path, nativeConfig, nativeOriginal, harness);
      return { backupPath, sharedBackupPath };
    } catch (error) {
      const written = JSON.stringify(sharedConfig, null, 2) + '\n';
      if (loadConfig(sharedPath, sharedDefinition).original !== written) throw new Error(`Harness save failed and shared settings changed before rollback: ${error.message}`);
      if (sharedOriginal === null) unlinkSync(sharedPath);
      else atomicSave(sharedPath, JSON.parse(sharedOriginal), written, sharedDefinition, sharedOriginal);
      throw error;
    }
  } finally { closeSync(lock); unlinkSync(lockPath); }
}

const cancelled = Symbol('cancelled');

/** Writes config only after all prompts succeed. Returns a result; never exits the host. */
export async function runConfigure(harnessKey = null, { scriptPath = defaultScript, ui, configPath, cwd = process.cwd(), env = process.env, settingsFile } = {}) {
  if (!ui && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Setup requires an interactive terminal; use manual MCP configuration for noninteractive setup');
  const terminal = ui ? null : createTerminalUI();
  const adapter = ui ?? terminal;
  const input = async (title, placeholder) => {
    const value = await adapter.input(title, placeholder);
    if (value === undefined || value === null) throw cancelled;
    if (typeof value !== 'string') throw new Error('UI input must return a string or undefined');
    return value.trim();
  };
  const select = async (title, options) => {
    const value = await adapter.select(title, options);
    if (value === undefined || value === null) throw cancelled;
    if (!options.includes(value)) throw new Error('UI select returned an invalid option');
    return value;
  };
  try {
    let candidate = harnessKey || detectHarness(env);
    if (candidate) {
      const detected = harnesses.find((h) => h.key === candidate);
      if (!detected) throw new Error(`Unknown harness: ${candidate}`);
      const confirmation = await select(`Configure ${detected.label}${harnessKey ? '' : ' (detected)'}?`, ['Confirm', 'Choose another harness']);
      if (confirmation !== 'Confirm') candidate = null;
    }
    if (!candidate) {
      const label = await select('Select your agent harness', harnesses.map((h) => h.label));
      candidate = harnesses.find((h) => h.label === label).key;
    }
    harnessKey = candidate;
    const harness = harnesses.find((h) => h.key === harnessKey);
    const sharedPath = resolve(cwd, settingsFile ?? settingsPath(env));
    const shared = loadConfig(sharedPath, sharedDefinition);
    let target = configPath;
    if (!target) {
      const paths = harness.paths(cwd, env);
      const options = [...paths, 'Enter an explicit config path'];
      target = await select('Destination config file', options);
      if (target === 'Enter an explicit config path') target = await input('Explicit MCP config file path');
      if (!target) throw new Error(`${harness.label} requires an explicit config path`);
    }
    const path = resolve(cwd, target);
    const { config, original } = loadConfig(path, harness);
    if (path === sharedPath) throw new Error('Harness config and DataVeil settings must use different files');
    let connectionName;
    let command, args, mode;
    const existingNames = Object.keys(shared.config.connections);
    if (existingNames.length) {
      const choice = await select('Shared DataVeil connection', [...existingNames, 'Add a new connection']);
      if (choice !== 'Add a new connection') connectionName = choice;
    }
    if (!connectionName) {
      let discoveredSqlcl;
      for (const candidate of ['sql', 'sqlcl']) {
        try { discoveredSqlcl = executable(candidate, cwd, env); break; } catch {}
      }
      const backend = await select('Select a stdio MCP backend (not a database CLI)', ['Custom stdio MCP backend', 'Oracle SQLcl MCP']);

      if (backend === 'Oracle SQLcl MCP') {
        command = executable((await input('SQLcl executable', discoveredSqlcl || 'sql')) || discoveredSqlcl || 'sql', cwd, env);
        const names = savedConnections(command);
        const choice = await select('Saved SQLcl connection', [...names, 'Type a saved connection name', 'No initial connection']);
        const connection = choice === 'Type a saved connection name' ? await input('Saved SQLcl connection name') : choice === 'No initial connection' ? '' : choice;
        if (choice === 'Type a saved connection name' && !connection) throw new Error('Saved connection name cannot be empty');
        args = connection ? ['-name', connection, '-mcp'] : ['-mcp'];
      } else {
        const entered = await input('MCP backend executable (single command, not a shell string)');
        if (!entered) throw new Error('Backend command cannot be empty');
        if (rawClients.has(commandBase(entered))) throw new Error(`${entered} is a database CLI, not a stdio MCP backend`);
        command = executable(entered, cwd, env);
        const encoded = await input('Backend arguments as a JSON string array (no passwords; use credential stores or inherited environment)', '[]');
        try { args = JSON.parse(encoded || '[]'); } catch { throw new Error('Backend arguments must be a JSON string array'); }
        if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('Backend arguments must be a JSON string array');
      }
      mode = await select('Privacy mode', ['redact', 'block']);
    } else {
      ({ command, args, mode } = shared.config.connections[connectionName]);
    }
    const servers = harness.getServers(config);
    let name;
    do {
      name = await input('MCP entry name (letters, digits, underscore or hyphen)', 'dataveil');
    } while (!/^[A-Za-z0-9_-]+$/.test(name));
    if (own(servers, name) && await select(`Replace existing entry ${name}?`, ['Keep existing (cancel)', 'Replace']) !== 'Replace') throw cancelled;
    if (!connectionName) {
      connectionName = name;
      if (own(shared.config.connections, connectionName) && await select(`Replace shared connection ${connectionName}? All registered harnesses will use the new settings after reconnecting.`, ['Keep existing (cancel)', 'Replace']) !== 'Replace') throw cancelled;
    }
    const launcher = {
      ...(harness.field === 'servers' ? { type: 'stdio' } : {}),
      command: nodeExecutable(cwd),
      args: [resolve(cwd, scriptPath || defaultScript), '--connection', connectionName, '--settings', sharedPath],
    };
    const entry = harness.createEntry ? harness.createEntry(launcher) : launcher;
    const sharedConfig = {
      ...shared.config,
      connections: { ...shared.config.connections, [connectionName]: { command, args, mode } },
      harnesses: [
        ...shared.config.harnesses.filter((registration) => registration.configPath !== path || registration.name !== name),
        { harnessKey, configPath: path, name, connection: connectionName },
      ],
    };
    validateSettings(sharedConfig);
    if (await select(`Save ${name} to ${path} and shared settings ${sharedPath}?`, ['Save', 'Cancel']) !== 'Save') throw cancelled;
    const backups = saveRegistration(sharedPath, sharedConfig, shared.original, path, harness.setServers(config, { ...servers, [name]: entry }), original, harness);
    const result = { status: 'configured', harnessKey, configPath: path, settingsFile: sharedPath, connectionName, name, server: entry, ...backups };
    if (terminal) console.log(`DataVeil configured: ${name} → shared connection ${connectionName}\nHarness config: ${path}\nShared settings: ${sharedPath}\nRestart/reload your client to connect. Live protection has not been verified.`);
    return result;
  } catch (error) {
    if (error === cancelled) return { status: 'cancelled' };
    throw error;
  } finally { terminal?.close(); }
}

function isDataveil(server, scriptPath) {
  const args = server.args ?? [];
  const base = commandBase(server.command ?? '');
  return ['dataveil', 'dataveil-mcp-proxy', 'dataveil-gateway'].includes(base)
    || (['node', 'nodejs'].includes(base) && typeof args[0] === 'string' &&
      (args[0] === scriptPath || args[0] === defaultScript || /(?:^|[\\/])dataveil-mcp-proxy[\\/]src[\\/]index\.js$/.test(args[0])))
    || (['npx', 'npm'].includes(base) && args.slice(0, args.indexOf('--command') < 0 ? args.length : args.indexOf('--command'))
      .some((arg) => /^(@dataveil\/mcp-proxy|dataveil|dataveil-mcp-proxy)(@[^/]+)?$/.test(arg)));
}

/** Format snapshots [{harnessKey?, label?, configPath, config?, error?}].
 * This describes saved configuration only, not a running MCP connection.
 */
export function formatStatusText(snapshots, { scriptPath = defaultScript } = {}) {
  const lines = ['DataVeil configuration status (not live protection)'];
  let count = 0;
  for (const snapshot of snapshots) {
    lines.push(`\n${snapshot.label ?? snapshot.harnessKey ?? 'MCP'}: ${snapshot.configPath}`);
    if (snapshot.error) { lines.push(`  Invalid config: ${snapshot.error}`); continue; }
    const harness = harnesses.find((h) => h.key === snapshot.harnessKey) ?? harnesses.find((h) => h.key === 'generic');
    try { validateConfig(snapshot.config, harness); }
    catch (error) { lines.push(`  Invalid config: ${error.message}`); continue; }
    for (const [name, nativeEntry] of Object.entries(harness.getServers(snapshot.config))) {
      const server = harness.normalize ? harness.normalize(nativeEntry) : nativeEntry;
      if (!isDataveil(server, scriptPath)) { lines.push(`  ${name}: not configured through DataVeil`); continue; }
      count++;
      const args = server.args ?? [];
      let gateway = commandBase(server.command ?? '') === 'dataveil-gateway';
      let cliMode, connection, file;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--mode') cliMode = args[++i];
        else if (arg === '--connection') connection = args[++i];
        else if (arg === '--settings') file = args[++i];
        else if (arg === '--gateway') gateway = true;
        else if (['--arg', '--sqlcl-arg', '--command', '--sqlcl', '--max-message-bytes', '--backend-timeout-ms'].includes(arg)) i++;
      }
      let sharedMode;
      if (connection) {
        try {
          const settings = loadSettings(file);
          if (!own(settings.connections, connection)) throw new Error(`Unknown shared connection: ${connection}`);
          sharedMode = settings.connections[connection].mode;
        } catch (error) { lines.push(`  ${name}: DataVeil configured; invalid shared settings: ${error.message}`); continue; }
      }
      const mode = cliMode ?? server.env?.DATAVEIL_PII_MODE ?? sharedMode ?? (gateway ? 'block' : 'redact');
      const disabled = gateway && ['0', 'false', 'off', 'no'].includes(String(server.env?.DATAVEIL_ENABLED ?? 'true').toLowerCase());
      const entryDisabled = server.enabled === false || server.disabled === true;
      lines.push(`  ${name}: DataVeil configured; ${disabled ? `protection disabled (DATAVEIL_ENABLED=${server.env.DATAVEIL_ENABLED})` : `${mode} mode`}${connection ? `; shared connection ${connection}` : ''}${entryDisabled ? '; MCP entry disabled' : ''}`);
    }
  }
  lines.push(`\nSummary: ${count} DataVeil configured entry(s). Runtime connection and protection have not been verified.`);
  return lines.join('\n');
}

/** Return status text; terminal callers also get stdout unless ui is supplied. */
export async function runStatus({ harnessKey, configPath, cwd = process.cwd(), scriptPath = defaultScript, ui, env = process.env, settingsFile } = {}) {
  const selected = harnessKey ? harnesses.filter((h) => h.key === harnessKey) : harnesses;
  if (!selected.length) throw new Error(`Unknown harness: ${harnessKey}`);
  if (configPath && !harnessKey) throw new Error('configPath requires harnessKey');
  const snapshots = [];
  let registrations = [];
  const sharedPath = resolve(cwd, settingsFile ?? settingsPath(env));
  if (existsSync(sharedPath)) {
    try { registrations = loadSettings(sharedPath).harnesses; }
    catch (error) { snapshots.push({ label: 'Shared DataVeil settings', configPath: sharedPath, error: error.message }); }
  }
  for (const harness of selected) {
    const paths = configPath ? [resolve(cwd, configPath)] : [...harness.paths(cwd, env).filter(existsSync), ...registrations.filter((entry) => entry.harnessKey === harness.key).map((entry) => entry.configPath)];
    for (const path of new Set(paths)) {
      try { snapshots.push({ harnessKey: harness.key, label: harness.label, configPath: path, config: loadConfig(path, harness).config }); }
      catch (error) { snapshots.push({ harnessKey: harness.key, label: harness.label, configPath: path, error: error.message }); }
    }
  }
  const text = formatStatusText(snapshots, { scriptPath });
  if (!ui) console.log(text);
  return text;
}
