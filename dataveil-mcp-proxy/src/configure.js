#!/usr/bin/env node
import { constants, existsSync, accessSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, lstatSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { loadSettings, settingsPath, validateSettings } from './settings.js';
import { harnesses, detectHarness } from './harnesses/index.js';
export { harnesses, detectHarness } from './harnesses/index.js';

const defaultScript = fileURLToPath(new URL('./index.js', import.meta.url));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const rawClients = new Set(['psql', 'sqlite3', 'mysql', 'mariadb', 'sqlcmd', 'sqlplus']);
const commandBase = (command) => basename(command).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');

function validateConfig(config, harness) { harness.validate(config); }

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
  try { config = original === null ? harness.empty?.() ?? {} : harness.parse ? harness.parse(original) : JSON.parse(original); }
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
    try { writeFileSync(fd, source ?? (harness.serialize ? harness.serialize(config, original) : JSON.stringify(config, null, 2) + '\n')); fsyncSync(fd); }
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

export const databaseOptions = ['Oracle SQLcl MCP', 'PostgreSQL', 'MySQL', 'MariaDB', 'SQLite', 'SQL Server', 'Other database / custom MCP'];
export const backendOptions = ['Installed stdio MCP executable', 'MCP package via npx', 'MCP package via uvx'];

/** Search explicit environment hints, PATH, then a bounded list of SQLcl locations. */
export function discoverSqlcl(cwd = process.cwd(), env = process.env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  const roots = [
    ...(env.SQLCL_HOME ? [resolve(cwd, env.SQLCL_HOME)] : []),
    join(home, 'sqlcl'), join(home, 'Downloads', 'sqlcl'), join(home, 'tools', 'sqlcl'),
    join(home, '.local', 'share', 'sqlcl'),
    '/opt/sqlcl', '/opt/oracle/sqlcl', '/usr/local/sqlcl', '/usr/share/sqlcl',
    ...(env.ORACLE_HOME ? [join(resolve(cwd, env.ORACLE_HOME), 'sqlcl')] : []),
    ...(env.ProgramFiles ? [join(env.ProgramFiles, 'Oracle', 'sqlcl')] : []),
  ];
  const candidates = [
    ...(env.DATAVEIL_SQLCL ? [env.DATAVEIL_SQLCL] : []),
    ...(env.SQLCL_HOME ? [join(resolve(cwd, env.SQLCL_HOME), 'bin', platform() === 'win32' ? 'sql.exe' : 'sql')] : []),
    'sql', 'sqlcl',
    ...roots.flatMap((root) => [join(root, 'bin', 'sql'), join(root, 'sqlcl', 'bin', 'sql')])
      .map((path) => platform() === 'win32' ? path + '.exe' : path),
  ];
  for (const candidate of candidates) {
    try { return executable(candidate, cwd, env); } catch { /* Try next installation. */ }
  }
  return null;
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

const settingsDefinition = {
  format: 'json', validate: validateSettings,
  empty: () => ({ version: 1, connections: {}, harnesses: [] }),
};

// Serialize setup writers and roll back DataVeil settings if the native write fails.
// All prompts finish before acquiring the lock or modifying either file.
function saveRegistration(settingsFilePath, settingsConfig, settingsOriginal, path, nativeConfig, nativeOriginal, harness) {
  if (settingsFilePath === path) throw new Error('Harness config and DataVeil settings must use different files');
  mkdirSync(dirname(settingsFilePath), { recursive: true });
  const lockPath = `${settingsFilePath}.lock`;
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another DataVeil setup is saving settings; retry after it finishes');
    throw error;
  }
  let settingsBackupPath;
  try {
    if (loadConfig(settingsFilePath, settingsDefinition).original !== settingsOriginal || loadConfig(path, harness).original !== nativeOriginal) throw new Error('Config changed during setup; retry configuration');
    settingsBackupPath = atomicSave(settingsFilePath, settingsConfig, settingsOriginal, settingsDefinition);
    try {
      const backupPath = atomicSave(path, nativeConfig, nativeOriginal, harness);
      return { backupPath, settingsBackupPath };
    } catch (error) {
      const written = JSON.stringify(settingsConfig, null, 2) + '\n';
      if (loadConfig(settingsFilePath, settingsDefinition).original !== written) throw new Error(`Harness save failed and DataVeil settings changed before rollback: ${error.message}`);
      if (settingsOriginal === null) unlinkSync(settingsFilePath);
      else atomicSave(settingsFilePath, JSON.parse(settingsOriginal), written, settingsDefinition, settingsOriginal);
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
    const settingsFilePath = resolve(cwd, settingsFile ?? settingsPath(env, harnessKey));
    const saved = loadConfig(settingsFilePath, settingsDefinition);
    if (saved.config.harnesses.some((entry) => entry.harnessKey !== harnessKey)) {
      throw new Error(`${harness.label} requires its own DataVeil settings file; choose a separate --settings path`);
    }
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
    if (path === settingsFilePath) throw new Error('Harness config and DataVeil settings must use different files');
    let connectionName;
    let command, args, mode;
    const existingNames = Object.keys(saved.config.connections);
    if (existingNames.length) {
      const choice = await select('Saved DataVeil connection', [...existingNames, 'Add a new connection']);
      if (choice !== 'Add a new connection') connectionName = choice;
    }
    if (!connectionName) {
      const database = await select('Which database MCP backend do you want to configure?', databaseOptions);
      if (database === 'Oracle SQLcl MCP') {
        command = discoverSqlcl(cwd, env);
        if (!command) {
          const entered = await input('SQLcl was not found. Enter the SQLcl sql executable path');
          if (!entered) throw new Error('SQLcl executable path cannot be empty');
          command = executable(entered, cwd, env);
        }
        const names = savedConnections(command);
        const choice = await select(`Saved SQLcl connection (using ${command})`, [...names, 'Type a saved connection name', 'No initial connection']);
        const connection = choice === 'Type a saved connection name' ? await input('Saved SQLcl connection name') : choice === 'No initial connection' ? '' : choice;
        if (choice === 'Type a saved connection name' && !connection) throw new Error('Saved connection name cannot be empty');
        args = connection ? ['-name', connection, '-mcp'] : ['-mcp'];
      } else {
        const backend = await select(`Choose a stdio MCP server for ${database}`, backendOptions);
        let prefix = [];
        if (backend === 'Installed stdio MCP executable') {
          const entered = await input('MCP backend executable (single command, not a shell string)');
          if (!entered) throw new Error('Backend command cannot be empty');
          if (rawClients.has(commandBase(entered))) throw new Error(`${entered} is a database CLI, not a stdio MCP backend`);
          command = executable(entered, cwd, env);
        } else {
          const runner = backend === 'MCP package via npx' ? 'npx' : 'uvx';
          command = executable(runner, cwd, env);
          const packageName = await input(`${database} MCP package to run with ${runner} (package name, not a shell command)`);
          if (!packageName || packageName.startsWith('-') || /\s/.test(packageName)) throw new Error('Enter a single MCP package name without flags or spaces');
          prefix = runner === 'npx' ? ['--yes', packageName] : [packageName];
        }
        const encoded = await input('Backend arguments as a JSON string array (no passwords; use credential stores or inherited environment)', '[]');
        let supplied;
        try { supplied = JSON.parse(encoded || '[]'); } catch { throw new Error('Backend arguments must be a JSON string array'); }
        if (!Array.isArray(supplied) || supplied.some((arg) => typeof arg !== 'string')) throw new Error('Backend arguments must be a JSON string array');
        args = [...prefix, ...supplied];
      }
      mode = await select('Privacy mode', ['redact', 'block']);
    } else {
      ({ command, args, mode } = saved.config.connections[connectionName]);
    }
    const servers = harness.getServers(config);
    let name;
    do {
      name = await input('MCP entry name (letters, digits, underscore or hyphen)', 'dataveil');
    } while (!/^[A-Za-z0-9_-]+$/.test(name));
    if (own(servers, name) && await select(`Replace existing entry ${name}?`, ['Keep existing (cancel)', 'Replace']) !== 'Replace') throw cancelled;
    if (!connectionName) {
      connectionName = name;
      if (own(saved.config.connections, connectionName) && await select(`Replace saved connection ${connectionName}? Registrations using this settings file will use the new settings after reconnecting.`, ['Keep existing (cancel)', 'Replace']) !== 'Replace') throw cancelled;
    }
    const launcher = {
      command: nodeExecutable(cwd),
      args: [resolve(cwd, scriptPath || defaultScript), '--connection', connectionName, '--settings', settingsFilePath],
    };
    const entry = harness.createEntry ? harness.createEntry(launcher) : launcher;
    const settingsConfig = {
      ...saved.config,
      connections: { ...saved.config.connections, [connectionName]: { command, args, mode } },
      harnesses: [
        ...saved.config.harnesses.filter((registration) => registration.configPath !== path || registration.name !== name),
        { harnessKey, configPath: path, name, connection: connectionName },
      ],
    };
    validateSettings(settingsConfig);
    if (await select(`Save ${name} to ${path} and DataVeil settings ${settingsFilePath}?`, ['Save', 'Cancel']) !== 'Save') throw cancelled;
    const backups = saveRegistration(settingsFilePath, settingsConfig, saved.original, path, harness.setServers(config, { ...servers, [name]: entry }), original, harness);
    const result = { status: 'configured', harnessKey, configPath: path, settingsFile: settingsFilePath, connectionName, name, server: entry, ...backups };
    if (terminal) console.log(`DataVeil configured: ${name} → saved connection ${connectionName}\nHarness config: ${path}\nDataVeil settings: ${settingsFilePath}\nRestart/reload your client to connect. Live protection has not been verified.`);
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
    const harness = harnesses.find((h) => h.key === snapshot.harnessKey);
    if (!harness) { lines.push('  Unsupported harness'); continue; }
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
      let savedMode;
      if (connection) {
        try {
          const settings = loadSettings(file);
          if (!own(settings.connections, connection)) throw new Error(`Unknown saved connection: ${connection}`);
          savedMode = settings.connections[connection].mode;
        } catch (error) { lines.push(`  ${name}: DataVeil configured; invalid DataVeil settings: ${error.message}`); continue; }
      }
      const mode = cliMode ?? server.env?.DATAVEIL_PII_MODE ?? savedMode ?? (gateway ? 'block' : 'redact');
      const disabled = gateway && ['0', 'false', 'off', 'no'].includes(String(server.env?.DATAVEIL_ENABLED ?? 'true').toLowerCase());
      const entryDisabled = server.enabled === false || server.disabled === true;
      lines.push(`  ${name}: DataVeil configured; ${disabled ? `protection disabled (DATAVEIL_ENABLED=${server.env.DATAVEIL_ENABLED})` : `${mode} mode`}${connection ? `; saved connection ${connection}` : ''}${entryDisabled ? '; MCP entry disabled' : ''}`);
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
  for (const harness of selected) {
    let registrations = [];
    const settingsFilePath = resolve(cwd, settingsFile ?? settingsPath(env, harness.key));
    if (existsSync(settingsFilePath)) {
      try { registrations = loadSettings(settingsFilePath).harnesses; }
      catch (error) { snapshots.push({ label: `${harness.label} DataVeil settings`, configPath: settingsFilePath, error: error.message }); }
    }
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
