#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

// =============================================================================
// Harness definitions — where each agent stores its MCP server config
// =============================================================================

const HARNESSES = [
  {
    key: 'claude-desktop',
    label: 'Claude Desktop',
    detect: () => {
      const macPath = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      if (existsSync(macPath)) return macPath;
      const winPath = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
      if (existsSync(winPath)) return winPath;
      return null;
    },
    configPath: () => {
      if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      if (platform() === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
      return null;
    },
    getServers: (cfg) => cfg?.mcpServers ?? {},
    setServers: (cfg, servers) => ({ ...cfg, mcpServers: servers }),
  },
  {
    key: 'pi',
    label: 'Pi (pi coding agent)',
    detect: () => {
      const globalPath = join(homedir(), '.pi', 'agent', 'mcp.json');
      if (existsSync(globalPath)) return globalPath;
      const localPath = join(process.cwd(), '.pi', 'mcp.json');
      if (existsSync(localPath)) return localPath;
      return null;
    },
    configPath: () => join(homedir(), '.pi', 'agent', 'mcp.json'),
    getServers: (cfg) => cfg?.mcpServers ?? {},
    setServers: (cfg, servers) => ({ ...cfg, mcpServers: servers }),
  },
  {
    key: 'cursor',
    label: 'Cursor',
    detect: () => {
      const globalPath = join(homedir(), '.cursor', 'mcp.json');
      if (existsSync(globalPath)) return globalPath;
      const localPath = join(process.cwd(), '.cursor', 'mcp.json');
      if (existsSync(localPath)) return localPath;
      return null;
    },
    configPath: () => join(homedir(), '.cursor', 'mcp.json'),
    getServers: (cfg) => cfg?.mcpServers ?? {},
    setServers: (cfg, servers) => ({ ...cfg, mcpServers: servers }),
  },
  {
    key: 'windsurf',
    label: 'Windsurf',
    detect: () => {
      const localPath = join(process.cwd(), '.windsurf', 'mcp.json');
      if (existsSync(localPath)) return localPath;
      return null;
    },
    configPath: () => join(process.cwd(), '.windsurf', 'mcp.json'),
    getServers: (cfg) => cfg?.mcpServers ?? {},
    setServers: (cfg, servers) => ({ ...cfg, mcpServers: servers }),
  },
  {
    key: 'cline',
    label: 'Cline (VS Code)',
    detect: () => {
      const localPath = join(process.cwd(), '.vscode', 'mcp.json');
      if (existsSync(localPath)) return localPath;
      const localPath2 = join(process.cwd(), 'cline_mcp_settings.json');
      if (existsSync(localPath2)) return localPath2;
      return null;
    },
    configPath: () => join(process.cwd(), '.vscode', 'mcp.json'),
    getServers: (cfg) => cfg?.mcpServers ?? {},
    setServers: (cfg, servers) => ({ ...cfg, mcpServers: servers }),
  },
  {
    key: 'generic',
    label: 'Generic (custom mcp.json)',
    detect: () => {
      const localPath = join(process.cwd(), 'mcp.json');
      if (existsSync(localPath)) return localPath;
      return null;
    },
    configPath: () => join(process.cwd(), 'mcp.json'),
    getServers: (cfg) => cfg?.mcpServers ?? {},
    setServers: (cfg, servers) => ({ ...cfg, mcpServers: servers }),
  },
];

// =============================================================================
// Utilities
// =============================================================================

function which(cmd) {
  try {
    const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8', env: process.env });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch { /* ignore */ }
  try {
    const r = spawnSync('which', [cmd], { encoding: 'utf8', env: process.env });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch { /* ignore */ }
  const extraPaths = [
    '/usr/local/bin', '/usr/bin', '/bin',
    '/opt/homebrew/bin', '/usr/local/opt/sqlcl/bin',
    join(homedir(), 'Downloads', 'sqlcl', 'bin'),
    join(homedir(), 'sqlcl', 'bin'),
  ];
  const pathEnv = process.env.PATH ?? '';
  for (const dir of [...pathEnv.split(':'), ...extraPaths]) {
    const candidate = join(dir, cmd);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function ask(rl, question, defaultValue = '') {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || null);
    });
  });
}

function choose(rl, question, options) {
  return new Promise((resolve) => {
    const lines = options.map((opt, i) => `  ${i + 1}. ${opt}`).join('\n');
    rl.question(`${question}\n${lines}\nEnter number: `, (answer) => {
      const idx = parseInt(answer.trim(), 10) - 1;
      resolve(options[idx] ?? null);
    });
  });
}

function discoverBackends() {
  const detected = [];
  const sqlclPath = which('sql');
  if (sqlclPath) detected.push({ key: 'sqlcl', label: 'Oracle SQLcl', path: sqlclPath, args: ['-mcp'] });
  const psqlPath = which('psql');
  if (psqlPath) detected.push({ key: 'psql', label: 'PostgreSQL', path: psqlPath, args: [] });
  const sqlitePath = which('sqlite3');
  if (sqlitePath) detected.push({ key: 'sqlite3', label: 'SQLite', path: sqlitePath, args: [] });
  return detected;
}

function listSqlclConnections(sqlclPath) {
  try {
    const result = spawnSync(sqlclPath, ['-nolog'], {
      encoding: 'utf8',
      input: 'connmgr list\n',
      timeout: 5000,
    });
    const connections = [];
    for (const line of (result.stdout ?? '').split('\n')) {
      const match = line.match(/^\s*[-\s]*([\w_]+)\s*$/);
      if (match && match[1] !== 'Connections') connections.push(match[1]);
    }
    return connections;
  } catch {
    return [];
  }
}

// =============================================================================
// Setup wizard
// =============================================================================

export async function runConfigure(harnessKey = null, { scriptPath = null } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Detect installed harnesses
    const detectedHarnesses = HARNESSES.filter((h) => h.detect());
    const allHarnesses = [...detectedHarnesses, ...HARNESSES.filter((h) => !detectedHarnesses.includes(h))];

    let harness;
    if (harnessKey) {
      harness = HARNESSES.find((h) => h.key === harnessKey);
      if (!harness) {
        console.error(`Unknown harness: ${harnessKey}`);
        console.error(`Available: ${HARNESSES.map((h) => h.key).join(', ')}`);
        process.exitCode = 1;
        return;
      }
    } else {
      const detectedLabels = detectedHarnesses.map((h) => `${h.label} (detected)`);
      const otherLabels = HARNESSES.filter((h) => !detectedHarnesses.includes(h)).map((h) => h.label);
      const choice = await choose(rl, 'Select your agent harness:', [...detectedLabels, ...otherLabels]);
      if (!choice) {
        console.log('Cancelled.');
        return;
      }
      harness = HARNESSES.find((h) => choice.startsWith(h.label));
    }

    const configPath = harness.configPath();
    if (!configPath) {
      console.error(`This harness is not supported on ${platform()}.`);
      process.exitCode = 1;
      return;
    }

    // Detect backends
    const backends = discoverBackends();
    if (backends.length === 0) {
      console.error('No supported database MCP backends found in PATH.');
      console.error('Install SQLcl, psql, or sqlite3 first.');
      process.exitCode = 1;
      return;
    }

    const backendLabels = backends.map((b) => `${b.label} (${b.path})`);
    const backendChoice = await choose(rl, 'Select a database backend:', backendLabels);
    if (!backendChoice) {
      console.log('Cancelled.');
      return;
    }
    const backend = backends.find((b) => backendChoice.startsWith(b.label)) ?? backends[0];
    let extraArgs = [...backend.args];

    // SQLcl connection selection
    if (backend.key === 'sqlcl') {
      const connections = listSqlclConnections(backend.path);
      if (connections.length > 0) {
        const connLabels = [...connections, 'Other (type manually)'];
        const connChoice = await choose(rl, 'Choose a saved SQLcl connection:', connLabels);
        if (connChoice && connChoice !== 'Other (type manually)') {
          extraArgs = ['-name', connChoice, '-mcp'];
        } else {
          const conn = await ask(rl, 'SQLcl connection name (optional)');
          if (conn) extraArgs = ['-name', conn, '-mcp'];
        }
      } else {
        const conn = await ask(rl, 'SQLcl connection name (optional)');
        if (conn) extraArgs = ['-name', conn, '-mcp'];
      }
    }

    // PII mode
    const modeChoice = await choose(rl, 'Privacy mode:', ['redact (replace sensitive values)', 'block (withhold entire result)']);
    const mode = modeChoice?.startsWith('redact') ? 'redact' : 'block';

    // Connection name
    const config = readJson(configPath) ?? {};
    const servers = harness.getServers(config);
    let name = await ask(rl, 'Connection name (e.g. prod_oracle, dev_postgres)', backend.key);
    while (servers[name] !== undefined) {
      console.log(`Name "${name}" already exists.`);
      name = await ask(rl, 'Choose a different name', `${backend.key}-${Math.floor(Math.random() * 10000)}`);
    }

    // Determine how the proxy should be invoked
    let proxyCommand;
    let proxyArgs;
    if (scriptPath) {
      proxyCommand = 'node';
      proxyArgs = [scriptPath, '--command', backend.path, ...extraArgs.flatMap((a) => ['--arg', a])];
    } else {
      // Prefer npx dataveil for portability across harnesses
      proxyCommand = 'npx';
      proxyArgs = ['dataveil', '--command', backend.path, ...extraArgs.flatMap((a) => ['--arg', a])];
    }

    const serverConfig = {
      command: proxyCommand,
      args: proxyArgs,
      env: {
        DATAVEIL_PII_MODE: mode,
        DATAVEIL_BACKEND_TIMEOUT_MS: '120000',
      },
    };

    const newServers = { ...servers, [name]: serverConfig };
    const newConfig = harness.setServers(config, newServers);
    writeJson(configPath, newConfig);

    console.log(`\n✅ DataVeil configured for ${harness.label}`);
    console.log(`   Server: "${name}"`);
    console.log(`   Backend: ${backend.label} (${backend.path})`);
    console.log(`   Mode: ${mode}`);
    console.log(`   Config: ${configPath}`);
    console.log(`\nRestart your agent to connect.`);
  } finally {
    rl.close();
  }
}

export async function runStatus() {
  console.log('🔒 DataVeil Privacy Proxy Status\n');

  let totalProtected = 0;
  let totalRaw = 0;

  for (const harness of HARNESSES) {
    const path = harness.detect();
    if (!path) continue;
    const cfg = readJson(path);
    if (!cfg) continue;
    const servers = harness.getServers(cfg);
    const entries = Object.entries(servers);
    if (entries.length === 0) continue;

    console.log(`📁 ${harness.label}`);
    console.log(`   ${path}`);

    for (const [name, server] of entries) {
      const isDataveil = typeof server.command === 'string' &&
        (server.command.includes('dataveil') ||
          (Array.isArray(server.args) && server.args.some((a) => typeof a === 'string' && a.includes('dataveil'))));

      if (isDataveil) {
        totalProtected++;
        const env = server.env ?? {};
        const mode = env.DATAVEIL_PII_MODE ?? 'redact';
        const args = Array.isArray(server.args) ? server.args : [];
        const cmdIdx = args.indexOf('--command');
        const backend = cmdIdx >= 0 ? args[cmdIdx + 1] : null;
        console.log(`   ✅ ${name} → DataVeil (${mode} mode)${backend ? `  backend: ${backend}` : ''}`);
      } else {
        const base = (String(server.command).split(/[\\/]/).pop() || '').toLowerCase();
        const isRaw = ['sql', 'sqlcl', 'psql', 'sqlite3', 'mysql', 'mariadb'].includes(base);
        if (isRaw) {
          totalRaw++;
          console.log(`   ⚠️  ${name} → UNPROTECTED raw database server`);
        }
      }
    }
    console.log('');
  }

  console.log(`Summary: ${totalProtected} protected, ${totalRaw} unprotected database MCP server(s)`);
}

export const harnesses = HARNESSES;
