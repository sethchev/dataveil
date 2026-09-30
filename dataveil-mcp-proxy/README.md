# @dataveil/mcp-proxy

Database-agnostic privacy proxy: any stdio MCP agent → DataVeil → any stdio MCP backend → database or service. Sanitizes tool-call results and backend stderr while preserving tool discovery metadata.

## Local installation

Registry publication has not been verified. From the repository root:

```sh
npm install
npm run build
npm test
npm pack --workspace @dataveil/mcp-proxy
npm install -g ./dataveil-mcp-proxy-0.1.0.tgz
```

After an authorized registry release, use `npm install -g @dataveil/mcp-proxy` or `npx --yes --package @dataveil/mcp-proxy dataveil --help`. Those registry commands have not been verified for a published release.

## Usage

```sh
dataveil setup
dataveil setup --harness codex
dataveil setup --harness opencode
dataveil setup --harness cursor
dataveil --configure --harness generic --config /absolute/path/to/mcp.json
dataveil status
dataveil --command /absolute/path/to/database-mcp-server --arg server-specific-argument
dataveil --command /absolute/path/to/sqlcl/bin/sql --arg -mcp
dataveil --gateway
dataveil-gateway
dataveil --help
```

Setup requires an interactive terminal. It detects the caller from available session/terminal markers, asks you to confirm or choose a harness, then prompts for destination, stdio backend, arguments, mode, and MCP entry name. Cancellation saves nothing. Existing TOML (Codex), JSON/JSONC (OpenCode), or strict JSON must match the harness schema, unrelated settings are preserved, replacements require confirmation, and existing files are backed up with restricted permissions. Generated configs use absolute Node, proxy, and shared settings paths. Connections and all configured harness registrations are retained in one user DataVeil `config.json`; adding another harness can reuse a saved connection. Multiple clients run independent stdio sessions against the same saved settings. Shared changes apply on reconnect.

Adapters: Codex CLI (TOML `mcp_servers`), OpenCode (JSON/JSONC `mcp`, `type: "local"`, command array), Claude Desktop, Cursor, legacy Windsurf, VS Code (`servers`, `type: "stdio"`), Cline (explicit path), Pi, and generic (`mcpServers`). Codex supports global/project `config.toml` and inherited `CODEX_HOME`. Detected Codex sessions prompt you to confirm Codex or choose another harness; an explicit `--harness` also requires confirmation. TOML settings are preserved but comments/formatting are normalized; the backup retains the original bytes. Unverified paths require explicit input. See [full per-harness documentation](https://github.com/sethchev/dataveil/blob/master/docs/install.md).

## Setup for each harness

Each command opens the wizard. Confirm the harness, choose the destination config, select a stdio MCP backend and its arguments, choose `redact` or `block`, and name the MCP entry. For Oracle, select **Oracle SQLcl MCP** and an optional saved SQLcl connection. Other databases require a separately installed compatible stdio MCP backend.

| Harness | Command after local installation | Destination to choose |
| --- | --- | --- |
| Codex CLI | `dataveil setup --harness codex` | Global `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) or project `.codex/config.toml`. |
| OpenCode | `dataveil setup --harness opencode` | Global `~/.config/opencode/opencode.json` / `opencode.jsonc` (respects `XDG_CONFIG_HOME`), project `opencode.json` / `opencode.jsonc`, or an inherited `OPENCODE_CONFIG` path. |
| Claude Desktop | `dataveil setup --harness claude-desktop` | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows `%APPDATA%/Claude/claude_desktop_config.json`; enter an explicit path elsewhere. |
| Cursor | `dataveil setup --harness cursor` | Global `~/.cursor/mcp.json` or project `.cursor/mcp.json`. |
| Legacy Windsurf | `dataveil setup --harness windsurf` | Existing `~/.codeium/windsurf/mcp_config.json`, or enter the config path shown by the application's MCP UI. |
| VS Code | `dataveil setup --harness vscode` | Project `.vscode/mcp.json`. |
| Cline | `dataveil setup --harness cline --config /absolute/path/to/cline_mcp_settings.json` | Open Cline's MCP configuration UI to find its settings file, then replace the placeholder with that path. |
| Pi | `dataveil setup --harness pi` | Global `~/.pi/agent/mcp.json` or project `.pi/mcp.json`. |
| Generic stdio MCP client | `dataveil setup --harness generic --config /absolute/path/to/mcp.json` | Replace the placeholder with your client's config path; this adapter expects a JSON `mcpServers` section. |

Project destinations are relative to the directory where you run setup. When running from this checkout, use `--config /absolute/path/to/your-project/config-file` to target another project. Add `--config /absolute/path/to/config-file` to override any native destination. OpenCode preserves JSONC comments and unrelated entries; Codex preserves TOML setting values and backs up the original comments/formatting.

To configure another harness, rerun its command and choose an existing **Shared DataVeil connection**. Setup retains earlier registrations so all configured harnesses can use the same backend settings and policy simultaneously. Use the same `--settings /absolute/path/to/dataveil/config.json` on each run if you override the default shared file.

Restart or reload the configured harness to connect. For Codex, inspect the generated entry with `codex mcp get database --json` (replace `database` with your entry name); for OpenCode, run `opencode mcp list`. In the other harnesses, inspect their MCP server/tool list after reloading. A saved registration alone does not verify live protection. Inspect all saved registrations with:

```sh
dataveil status
```

For Pi's in-agent setup, load `pi --extension ./extensions/dataveil.ts` from the repository root and run `/dataveil setup` inside Pi.

See [installation and per-harness configuration](https://github.com/sethchev/dataveil/blob/master/docs/install.md) for manual examples and vendor references.

Database engines are supported through their stdio MCP backend: Oracle has a SQLcl setup helper; PostgreSQL, MySQL, MariaDB, SQLite, SQL Server and other engines need a separately supplied compatible backend. Database-specific integrations have not all been tested.

Raw `psql`, `sqlite3`, `mysql`, and `mariadb` are not MCP servers. Keep credentials in backend stores or inherited environment, never wizard arguments or chat.

Direct mode defaults to `redact`; gateway to `block`. `--mode` overrides `DATAVEIL_PII_MODE`. `DATAVEIL_ENABLED=false` disables gateway protection. Gateway uses `DATAVEIL_PROFILES_FILE` and tools `dataveil_connect`, `dataveil_disconnect`, and `dataveil_status`. CLI status describes saved configuration, not live protection. `--settings FILE` overrides the shared settings file and `--connection NAME` launches a saved connection. Existing direct `--command` registrations still work.

Redaction is heuristic and may miss unknown sensitive fields or produce false positives. Metadata is not sanitized. DataVeil does not protect direct database protocols or remote HTTP MCP. Backend least privilege remains necessary. Malformed/oversized output fails closed; default limits are 16 MiB and a 120-second backend timeout.

No real desktop UI integration or registry publication is claimed by config generation.

## License

UNLICENSED. All rights reserved; no license has been granted.
