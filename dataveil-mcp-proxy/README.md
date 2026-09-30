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
dataveil setup --harness cursor
dataveil --configure --harness generic --config /absolute/path/to/mcp.json
dataveil status
dataveil --command /absolute/path/to/database-mcp-server --arg server-specific-argument
dataveil --command /absolute/path/to/sqlcl/bin/sql --arg -mcp
dataveil --gateway
dataveil-gateway
dataveil --help
```

Setup requires an interactive terminal. It detects the caller from available session/terminal markers, asks you to confirm or choose a harness, then prompts for destination, stdio backend, arguments, mode, and MCP entry name. Cancellation saves nothing. Existing TOML (Codex) or strict JSON must match the harness schema, unrelated settings are preserved, replacements require confirmation, and existing files are backed up with restricted permissions. Generated configs use absolute Node, proxy, and shared settings paths. Connections and all configured harness registrations are retained in one user DataVeil `config.json`; adding another harness can reuse a saved connection. Multiple clients run independent stdio sessions against the same saved settings. Shared changes apply on reconnect.

Adapters: Codex CLI (TOML `mcp_servers`), Claude Desktop, Cursor, legacy Windsurf, VS Code (`servers`, `type: "stdio"`), Cline (explicit path), Pi, and generic (`mcpServers`). Codex supports global/project `config.toml` and inherited `CODEX_HOME`. Detected Codex sessions prompt you to confirm Codex or choose another harness; an explicit `--harness` also requires confirmation. TOML settings are preserved but comments/formatting are normalized; the backup retains the original bytes. Unverified paths require explicit input. See [full per-harness documentation](https://github.com/sethchev/dataveil/blob/master/docs/install.md).

Database engines are supported through their stdio MCP backend: Oracle has a SQLcl setup helper; PostgreSQL, MySQL, MariaDB, SQLite, SQL Server and other engines need a separately supplied compatible backend. Database-specific integrations have not all been tested.

Raw `psql`, `sqlite3`, `mysql`, and `mariadb` are not MCP servers. Keep credentials in backend stores or inherited environment, never wizard arguments or chat.

Direct mode defaults to `redact`; gateway to `block`. `--mode` overrides `DATAVEIL_PII_MODE`. `DATAVEIL_ENABLED=false` disables gateway protection. Gateway uses `DATAVEIL_PROFILES_FILE` and tools `dataveil_connect`, `dataveil_disconnect`, and `dataveil_status`. CLI status describes saved configuration, not live protection. `--settings FILE` overrides the shared settings file and `--connection NAME` launches a saved connection. Existing direct `--command` registrations still work.

Redaction is heuristic and may miss unknown sensitive fields or produce false positives. Metadata is not sanitized. DataVeil does not protect direct database protocols or remote HTTP MCP. Backend least privilege remains necessary. Malformed/oversized output fails closed; default limits are 16 MiB and a 120-second backend timeout.

No real desktop UI integration or registry publication is claimed by config generation.

## License

UNLICENSED. All rights reserved; no license has been granted.
