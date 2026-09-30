# DataVeil

DataVeil is a database-agnostic privacy proxy for stdio MCP servers:

```text
Any stdio MCP agent → DataVeil → Any stdio MCP backend → Database or service
```

It forwards requests, tool schemas, and metadata, and sanitizes backend `tools/call` results before they reach the client. It also sanitizes backend stderr. Direct proxy defaults to redaction; gateway defaults to blocking results with detected sensitive data.

## Run from a checkout

Requires Node.js 20 or newer. Clone and install dependencies:

```sh
git clone https://github.com/sethchev/dataveil.git
cd dataveil
npm install
```

Run the setup command for your harness below from the repository root. You can also run `node ./dataveil-mcp-proxy/src/index.js setup` to confirm the detected harness or choose one. No build step or global installation is required to run setup.

Setup also supports `--configure`, `--harness` and `--config`. It detects the caller when session/terminal markers are available, asks you to confirm the harness, and shares one cancellable wizard across terminal and Pi, preserves existing config, confirms replacements, and creates backups. Generated launchers use absolute executable, script and shared settings paths. Setup saves backend connections and every configured harness registration in `~/.config/dataveil/config.json` (platform/environment overrides are supported). Adding another harness reuses a saved connection while keeping its native registration separate. Multiple harnesses can read those settings and run independent MCP sessions at once; shared changes apply after reconnecting.

For an arbitrary stdio MCP backend:

```sh
node ./dataveil-mcp-proxy/src/index.js --command /absolute/path/to/database-mcp-server --arg server-specific-argument
```

For SQLcl's MCP mode:

```sh
node ./dataveil-mcp-proxy/src/index.js --command /absolute/path/to/sqlcl/bin/sql --arg -name --arg demo_saved_connection --arg -mcp
```

Raw `psql`, `sqlite3`, `mysql`, and `mariadb` are database clients, not MCP servers. Use a separate stdio MCP backend. Keep credentials in backend credential stores or inherited environment variables, away from chat and plain config arguments.

## Installable package and harnesses

The standalone package is prepared locally; npm publication has not been verified. Pack and install locally:

```sh
npm pack --workspace @dataveil/mcp-proxy
npm install -g ./dataveil-mcp-proxy-0.1.0.tgz
dataveil setup --harness generic --config /absolute/path/to/mcp.json
```

Config adapters cover Codex CLI, OpenCode, Claude Desktop, Cursor, legacy Windsurf, VS Code, Cline, Pi, and generic clients. Cline and unverified platform locations require explicit paths. Codex uses TOML `mcp_servers`; VS Code uses JSON `servers`; OpenCode uses JSON/JSONC `mcp` with a command array; the other adapters use JSON `mcpServers`. Adapter tests do not prove real harness UI integration.

## Setup for each harness

Each command opens the wizard. Confirm the harness, choose the destination config, select a stdio MCP backend and its arguments, choose `redact` or `block`, and name the MCP entry. For Oracle, select **Oracle SQLcl MCP** and an optional saved SQLcl connection. Other databases require a separately installed compatible stdio MCP backend.

| Harness | Command from the repository root | Destination to choose |
| --- | --- | --- |
| Codex CLI | `node ./dataveil-mcp-proxy/src/index.js setup --harness codex` | Global `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) or project `.codex/config.toml`. |
| OpenCode | `node ./dataveil-mcp-proxy/src/index.js setup --harness opencode` | Global `~/.config/opencode/opencode.json` / `opencode.jsonc` (respects `XDG_CONFIG_HOME`), project `opencode.json` / `opencode.jsonc`, or an inherited `OPENCODE_CONFIG` path. |
| Claude Desktop | `node ./dataveil-mcp-proxy/src/index.js setup --harness claude-desktop` | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows `%APPDATA%/Claude/claude_desktop_config.json`; enter an explicit path elsewhere. |
| Cursor | `node ./dataveil-mcp-proxy/src/index.js setup --harness cursor` | Global `~/.cursor/mcp.json` or project `.cursor/mcp.json`. |
| Legacy Windsurf | `node ./dataveil-mcp-proxy/src/index.js setup --harness windsurf` | Existing `~/.codeium/windsurf/mcp_config.json`, or enter the config path shown by the application's MCP UI. |
| VS Code | `node ./dataveil-mcp-proxy/src/index.js setup --harness vscode` | Project `.vscode/mcp.json`. |
| Cline | `node ./dataveil-mcp-proxy/src/index.js setup --harness cline --config /absolute/path/to/cline_mcp_settings.json` | Open Cline's MCP configuration UI to find its settings file, then replace the placeholder with that path. |
| Pi | `node ./dataveil-mcp-proxy/src/index.js setup --harness pi` | Global `~/.pi/agent/mcp.json` or project `.pi/mcp.json`. |
| Generic stdio MCP client | `node ./dataveil-mcp-proxy/src/index.js setup --harness generic --config /absolute/path/to/mcp.json` | Replace the placeholder with your client's config path; this adapter expects a JSON `mcpServers` section. |

Project destinations are relative to the directory where you run setup. When running from this checkout, use `--config /absolute/path/to/your-project/config-file` to target another project. Add `--config /absolute/path/to/config-file` to override any native destination. OpenCode preserves JSONC comments and unrelated entries; Codex preserves TOML setting values and backs up the original comments/formatting.

To configure another harness, rerun its command and choose an existing **Shared DataVeil connection**. Setup retains earlier registrations so all configured harnesses can use the same backend settings and policy simultaneously. Use the same `--settings /absolute/path/to/dataveil/config.json` on each run if you override the default shared file.

Restart or reload the configured harness to connect. For Codex, inspect the generated entry with `codex mcp get database --json` (replace `database` with your entry name); for OpenCode, run `opencode mcp list`. In the other harnesses, inspect their MCP server/tool list after reloading. A saved registration alone does not verify live protection. Inspect all saved registrations with:

```sh
node ./dataveil-mcp-proxy/src/index.js status
```

After installing the local standalone package above, replace `node ./dataveil-mcp-proxy/src/index.js` in these commands with `dataveil`. Pi users can also load `pi --extension ./extensions/dataveil.ts` from the checkout and run `/dataveil setup` inside Pi.

See [installation and per-harness configuration](docs/install.md) for manual examples and vendor references.

## Supported harnesses and databases

Setup adapters support **Codex CLI, OpenCode, Claude Desktop, Cursor, legacy Windsurf, VS Code, Cline, Pi, and generic stdio MCP clients**. Cline requires an explicit config path; legacy Windsurf requires an existing legacy file or an explicit path. Config adapters are tested; real desktop UI integration is still pending.

Database support comes from the backend MCP server. The SQLcl setup helper supports **Oracle SQLcl's MCP mode**. **PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, and other engines** can be used through a separately supplied compatible stdio MCP backend. These are protocol-level compatibility examples, not claims that each database/backend has been tested here. Raw database clients and direct database protocols are unsupported.

## Pi and gateway

Load the root Pi package or `pi --extension ./extensions/dataveil.ts`. Use `/dataveil setup`, `/dataveil status`, and `/dataveil gateway`.

`dataveil --gateway` and `dataveil-gateway` expose `dataveil_connect`, `dataveil_disconnect`, and `dataveil_status` for named backends in a local profile file. Backend tools appear after profile selection. `DATAVEIL_ENABLED=false` disables gateway protection; `--mode` overrides the environment policy.

CLI and Pi status report **configured** entries, not verified live protection. Gateway runtime status describes its own routing/policy only.

## Privacy limits

Redaction detects common sensitive field names and text patterns, including emails, SSNs, phone numbers, IP addresses, credential assignments, Oracle connect strings, and sensitive CSV columns. Detection is heuristic: unknown fields may be missed and false positives can occur. Metadata is preserved rather than sanitized. Direct database protocols and remote HTTP MCP are outside the proxy's scope. Least privilege on the backend remains necessary.

Malformed, incomplete, or oversized MCP messages fail closed. Defaults are a 16 MiB message limit and 120-second response timeout. Run `--help` for all options.

## Development and license

Tests import the shared wizard and actual Pi handler implementation, spawn the CLI, and exercise fake backends. See [the implementation plan](docs/multi-harness-plan.md) and [verification record](docs/verification.md) for completed work and remaining integration checks.

No license has been added. Package metadata is `UNLICENSED`; all rights reserved unless a license is added later.
