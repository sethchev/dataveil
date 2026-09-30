/**
 * DataVeil Pi Extension
 *
 * Auto-discovers database MCP servers and enforces privacy proxying through
 * DataVeil. Provides an interactive `/dataveil setup` command.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// =============================================================================
// Constants
// =============================================================================

const AGENT_DIR = join(homedir(), ".pi", "agent");
const GLOBAL_MCP = join(AGENT_DIR, "mcp.json");

function findDataveilScript(): string | null {
	// 1. Development: same directory as extension
	const devPath = resolve(join(dirname(__dirname), "dataveil-mcp-proxy", "src", "index.js"));
	if (existsSync(devPath)) return devPath;

	// 2. Global npm install
	try {
		const result = spawnSync("npm", ["root", "-g"], { encoding: "utf8" });
		if (result.status === 0) {
			const candidate = join(result.stdout.trim(), "dataveil", "dataveil-mcp-proxy", "src", "index.js");
			if (existsSync(candidate)) return candidate;
		}
	} catch { /* ignore */ }

	return null;
}

function which(cmd: string): string | null {
	// Try "command -v" first — more portable than "which"
	try {
		const result = spawnSync("sh", ["-c", `command -v ${cmd}`], {
			encoding: "utf8",
			env: process.env,
		});
		if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
	} catch { /* ignore */ }

	// Fall back to "which"
	try {
		const result = spawnSync("which", [cmd], { encoding: "utf8", env: process.env });
		if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
	} catch { /* ignore */ }

	// Scan PATH directly for common install locations
	const pathEnv = process.env.PATH ?? "";
	const paths = pathEnv.split(":");
	const extraPaths = [
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/opt/homebrew/bin",
		"/usr/local/opt/sqlcl/bin",
		join(homedir(), "Downloads", "sqlcl", "bin"),
		join(homedir(), "sqlcl", "bin"),
	];
	for (const dir of [...paths, ...extraPaths]) {
		const candidate = join(dir, cmd);
		if (existsSync(candidate)) return candidate;
	}

	return null;
}

function readMcpJson(path: string): { mcpServers?: Record<string, unknown> } | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function writeMcpJson(path: string, data: unknown): boolean {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
		return true;
	} catch {
		return false;
	}
}

function isRawDatabaseServer(config: Record<string, unknown>): boolean {
	if (typeof config.command !== "string") return false;
	const cmd = config.command;
	if (cmd.includes("dataveil")) return false;
	if (Array.isArray(config.args) && config.args.some((a) => typeof a === "string" && a.includes("dataveil"))) {
		return false;
	}
	const base = cmd.split(/[\/\\]/).pop()?.toLowerCase() ?? "";
	return ["sql", "sqlcl", "psql", "sqlite3", "mysql", "mariadb"].includes(base);
}

function isDataveilProtected(config: Record<string, unknown>): boolean {
	if (typeof config.command === "string" && config.command.includes("dataveil")) return true;
	if (Array.isArray(config.args) && config.args.some((a) => typeof a === "string" && a.includes("dataveil"))) return true;
	return false;
}

function getPiiMode(config: Record<string, unknown>): string {
	const env = config.env as Record<string, unknown> | undefined;
	if (env && typeof env.DATAVEIL_PII_MODE === "string") return env.DATAVEIL_PII_MODE;
	return "redact";
}

function getBackendFromConfig(config: Record<string, unknown>): string | null {
	const args = Array.isArray(config.args) ? config.args as string[] : [];
	const cmdIdx = args.indexOf("--command");
	if (cmdIdx >= 0 && args[cmdIdx + 1]) return args[cmdIdx + 1];
	for (let i = 0; i < args.length; i++) {
		if (args[i].includes("dataveil")) continue;
		if (args[i].startsWith("/") || args[i].startsWith("~")) return args[i];
	}
	return null;
}

export default function dataveilExtension(pi: ExtensionAPI) {
	// Warn about unprotected database servers on session start
	pi.on("session_start", async (_event, ctx) => {
		try {
			if (!ctx.hasUI) return;
			// getMcpServers may not exist on all ExtensionAPI versions
			const getServers = (pi as unknown as Record<string, unknown>).getMcpServers as (() => Record<string, unknown>) | undefined;
			if (!getServers) return;
			const servers = getServers();
			const rawDbServers: string[] = [];
			for (const [name, config] of Object.entries(servers)) {
				if (typeof config === "object" && config !== null && isRawDatabaseServer(config as Record<string, unknown>)) {
					rawDbServers.push(name);
				}
			}
			const protectedServers: string[] = [];
			for (const [name, config] of Object.entries(servers)) {
				if (typeof config === "object" && config !== null && isDataveilProtected(config as Record<string, unknown>)) {
					protectedServers.push(name);
				}
			}

			if (protectedServers.length > 0) {
				ctx.ui.notify(
					`DataVeil active: protecting ${protectedServers.length} MCP server(s): ${protectedServers.join(", ")}. ` +
					`Run \`/dataveil status\` for details.`,
					"info",
				);
			}
			if (rawDbServers.length > 0) {
				ctx.ui.notify(
					`DataVeil: unprotected database MCP server(s) detected: ${rawDbServers.join(", ")}. ` +
					`Run \`/dataveil setup\` to wrap them with privacy protection.`,
					"warning",
				);
			}
		} catch { /* ignore if API unavailable */ }
	});

	// Interactive setup command
	pi.registerCommand("dataveil setup", {
		description: "Configure DataVeil privacy proxy for database MCP servers",
		handler: async (_args, ctx) => {
			const scriptPath = findDataveilScript();
			if (!scriptPath) {
				if (ctx.hasUI) {
					ctx.ui.notify("DataVeil proxy script not found. Make sure DataVeil is installed.", "error");
				}
				return;
			}

			// Detect available backends
			const detected: Array<{ key: string; label: string; path: string; args: string[] }> = [];
			const sqlclPath = which("sql");
			if (sqlclPath) detected.push({ key: "sqlcl", label: "Oracle SQLcl", path: sqlclPath, args: ["-mcp"] });
			const psqlPath = which("psql");
			if (psqlPath) detected.push({ key: "psql", label: "PostgreSQL", path: psqlPath, args: [] });
			const sqlitePath = which("sqlite3");
			if (sqlitePath) detected.push({ key: "sqlite3", label: "SQLite", path: sqlitePath, args: [] });

			// Also check common SQLcl download location
			const sqlclDownloadPath = join(homedir(), "Downloads", "sqlcl", "bin", "sql");
			if (existsSync(sqlclDownloadPath) && !detected.some((d) => d.key === "sqlcl")) {
				detected.push({ key: "sqlcl", label: "Oracle SQLcl (~/Downloads)", path: sqlclDownloadPath, args: ["-mcp"] });
			}

			if (detected.length === 0) {
				if (ctx.hasUI) {
					ctx.ui.notify("No supported database MCP backends found. Install SQLcl, psql, or sqlite3 first.", "error");
				}
				return;
			}

			const targetPath = GLOBAL_MCP;
			const existing = readMcpJson(targetPath) ?? { mcpServers: {} };
			const mcpServers = (existing.mcpServers ?? {}) as Record<string, unknown>;

			// Prompt for a connection name even in non-TUI mode if possible
			let serverName: string | null = null;
			if (ctx.hasUI) {
				serverName = await ctx.ui.input(
					"Connection name",
					"Name for this MCP server (e.g. prod_oracle, dev_postgres)",
				);
			}
			if (!serverName?.trim()) {
				// Non-TUI or empty input: fall back to a safe default
				serverName = detected[0].key;
				let counter = 1;
				while (mcpServers[serverName] !== undefined) {
					serverName = `${detected[0].key}-${counter++}`;
				}
			}
			serverName = serverName.trim();

			if (!ctx.hasUI) {
				// Non-TUI mode: write a default config using the first detected backend
				const backend = detected[0];
				mcpServers[serverName] = {
					command: "node",
					args: [scriptPath, "--command", backend.path, ...backend.args.flatMap((a) => ["--arg", a])],
					env: { DATAVEIL_PII_MODE: "redact", DATAVEIL_BACKEND_TIMEOUT_MS: "120000" },
					exposure: "codemode",
				};
				writeMcpJson(targetPath, { ...existing, mcpServers });
				return;
			}

			// TUI mode: interactive selection
			const backendChoice = await ctx.ui.select(
				"Select a database backend to protect with DataVeil:",
				detected.map((d) => `${d.label} (${d.path})`),
			);
			if (!backendChoice) return;

			const backend = detected.find((d) => backendChoice.startsWith(d.label)) ?? detected[0];
			let extraArgs: string[] = [...backend.args];

			if (backend.key === "sqlcl") {
				// Try to list saved connections
				try {
					const result = spawnSync(backend.path, ["-nolog"], {
						encoding: "utf8",
						input: "connmgr list\n",
						timeout: 5000,
					});
					const connections: string[] = [];
					for (const line of (result.stdout ?? "").split("\n")) {
						const match = line.match(/^\s*[-\s]*([\w_]+)\s*$/);
						if (match && match[1] !== "Connections") connections.push(match[1]);
					}
					if (connections.length > 0) {
						const conn = await ctx.ui.select("Choose a saved SQLcl connection:", connections);
						if (conn) {
							extraArgs = ["-name", conn, "-mcp"];
						}
					} else {
						const conn = await ctx.ui.input("SQLcl connection name", "Optional: saved connection name to use");
						if (conn?.trim()) {
							extraArgs = ["-name", conn.trim(), "-mcp"];
						}
					}
				} catch {
					const conn = await ctx.ui.input("SQLcl connection name", "Optional: saved connection name to use");
					if (conn?.trim()) {
						extraArgs = ["-name", conn.trim(), "-mcp"];
					}
				}
			}

			const scope = await ctx.ui.select("Save configuration to:", ["Global (~/.pi/agent/mcp.json)", "Project (.pi/mcp.json)"]);
			const finalTargetPath = scope?.includes("Global") ? GLOBAL_MCP : join(process.cwd(), ".pi", "mcp.json");

			const finalExisting = readMcpJson(finalTargetPath) ?? { mcpServers: {} };
			const finalMcpServers = (finalExisting.mcpServers ?? {}) as Record<string, unknown>;

			// Re-prompt if name collides in the chosen file
			while (serverName != null && finalMcpServers[serverName] !== undefined) {
				const next: string | null = await ctx.ui.input(
					"Connection name already exists",
					`Choose a different name (current: ${serverName})`,
				);
				serverName = next?.trim() || `${backend.key}-${Math.floor(Math.random() * 10000)}`;
			}

			if (serverName == null) {
				ctx.ui.notify("No valid connection name provided.", "error");
				return;
			}

			const dataveilConfig: Record<string, unknown> = {
				command: "node",
				args: [scriptPath, "--command", backend.path, ...extraArgs.flatMap((a) => ["--arg", a])],
				env: {
					DATAVEIL_PII_MODE: "redact",
					DATAVEIL_BACKEND_TIMEOUT_MS: "120000",
				},
				exposure: "codemode",
			};

			finalMcpServers[serverName] = dataveilConfig;
			const success = writeMcpJson(finalTargetPath, { ...finalExisting, mcpServers: finalMcpServers });

			if (success) {
				ctx.ui.notify(
					`DataVeil configured: server "${serverName}" -> ${backend.label}. ` +
					`Run \`/reload\` or start a new session to connect.`,
					"success",
				);
			} else {
				ctx.ui.notify("Failed to write MCP configuration file.", "error");
			}
		},
	});

	// Status command to show DataVeil protection state
	pi.registerCommand("dataveil status", {
		description: "Show which MCP servers are protected by DataVeil",
		handler: async (_args, ctx) => {
			const lines: string[] = [];
			lines.push("🔒 DataVeil Privacy Proxy Status");
			lines.push("");

			// Check global config
			const globalConfig = readMcpJson(GLOBAL_MCP);
			const projectConfig = readMcpJson(join(process.cwd(), ".pi", "mcp.json"));

			let totalProtected = 0;
			let totalRaw = 0;

			const sources = [
				{ label: "Global (~/.pi/agent/mcp.json)", cfg: globalConfig },
				{ label: "Project (.pi/mcp.json)", cfg: projectConfig },
			];

			for (const source of sources) {
				if (!source.cfg || !source.cfg.mcpServers) continue;
				lines.push(`📁 ${source.label}`);
				let hasAny = false;
				for (const [name, config] of Object.entries(source.cfg.mcpServers)) {
					if (typeof config !== "object" || config === null) continue;
					const cfg = config as Record<string, unknown>;
					if (isDataveilProtected(cfg)) {
						totalProtected++;
						const mode = getPiiMode(cfg);
						const backend = getBackendFromConfig(cfg);
						lines.push(`   ✅ ${name}  → DataVeil (${mode} mode)` + (backend ? `  backend: ${backend}` : ""));
						hasAny = true;
					} else if (isRawDatabaseServer(cfg)) {
						totalRaw++;
						lines.push(`   ⚠️  ${name}  → UNPROTECTED raw database server`);
						hasAny = true;
					}
				}
				if (!hasAny) {
					lines.push("   (no database servers found)");
				}
				lines.push("");
			}

			// Try to read runtime state from pi API if available
			try {
				const getServers = (pi as unknown as Record<string, unknown>).getMcpServers as (() => Record<string, unknown>) | undefined;
				if (getServers) {
					const servers = getServers();
					const activeProtected: string[] = [];
					const activeRaw: string[] = [];
					for (const [name, config] of Object.entries(servers)) {
						if (typeof config !== "object" || config === null) continue;
						if (isDataveilProtected(config as Record<string, unknown>)) {
							activeProtected.push(name);
						} else if (isRawDatabaseServer(config as Record<string, unknown>)) {
							activeRaw.push(name);
						}
					}
					if (activeProtected.length > 0 || activeRaw.length > 0) {
						lines.push("🟢 Active session:");
						for (const name of activeProtected) lines.push(`   ✅ ${name} (protected)`);
						for (const name of activeRaw) lines.push(`   ⚠️  ${name} (unprotected)`);
						lines.push("");
					}
				}
			} catch { /* ignore if API unavailable */ }

			lines.push(`Summary: ${totalProtected} protected, ${totalRaw} unprotected database MCP server(s)`);

			const message = lines.join("\n");
			if (ctx.hasUI) {
				ctx.ui.notify(message, totalRaw > 0 ? "warning" : "info");
			}
			// Always log so it's visible in non-TUI mode too
			console.log(message);
		},
	});

	// Gateway command for multi-database projects
	pi.registerCommand("dataveil gateway", {
		description: "Register DataVeil gateway mode for named connection profiles",
		handler: async (_args, ctx) => {
			const scriptPath = findDataveilScript();
			if (!scriptPath) {
				if (ctx.hasUI) {
					ctx.ui.notify("DataVeil proxy script not found.", "error");
				}
				return;
			}

			const profilesPath = join(process.cwd(), "dataveil-profiles.json");
			if (!existsSync(profilesPath)) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`Create ${profilesPath} first with connection profiles, then run this command again.`,
						"warning",
					);
				}
				return;
			}

			pi.registerMcpServer("dataveil", {
				command: "node",
				args: [scriptPath, "--gateway"],
				env: {
					DATAVEIL_PROFILES_FILE: profilesPath,
					DATAVEIL_PII_MODE: "block",
				},
				exposure: "codemode",
			});

			if (ctx.hasUI) {
				ctx.ui.notify("DataVeil gateway registered for this session. Use `dataveil_connect` to select a profile.", "success");
			}
		},
	});
}
