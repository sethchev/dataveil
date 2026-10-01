# Install DataVeil

From a checkout, install dependencies with `npm install`. Setup runs directly from source:

```sh
node ./dataveil-mcp-proxy/src/index.js setup --harness pi
node ./dataveil-mcp-proxy/src/index.js setup --harness opencode
node ./dataveil-mcp-proxy/src/index.js setup --harness codex
```

Follow each harness's own guide: [Pi](../harnesses/pi/README.md), [OpenCode](../harnesses/opencode/README.md), [Codex](../harnesses/codex/README.md). Configure and test one harness before moving to the next.

## Backend setup

Setup confirms the harness and asks for its native config destination, database/backend, privacy mode, and entry name. Oracle SQLcl MCP is the first database choice, followed by PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, and Other database / custom MCP.

SQLcl discovery checks `DATAVEIL_SQLCL`, `SQLCL_HOME/bin/sql`, PATH, and common extracted locations such as `~/Downloads/sqlcl/bin/sql` and `/opt/sqlcl/bin/sql`. A found executable is shown while selecting an optional saved connection. If discovery fails, enter the executable path. Setup adds `-mcp` automatically.

Other databases require an installed stdio MCP executable, or a user-selected MCP package through installed `npx` or `uvx`. Enter backend arguments as a JSON string array. Setup records the command; the harness executes it on connection. Database names do not select a provider or install a database server. Raw `psql`, `sqlite3`, `mysql`, and `mariadb` are database clients, not MCP servers.

Choose `redact` or `block`. Keep credentials in backend stores or inherited environment variables, away from chat and wizard arguments. Use absolute backend file paths.

Cancellation saves nothing. Unrelated native settings are preserved, replacements require confirmation, and existing files receive backups. Malformed configs and concurrent edits are refused. Codex TOML comments/formatting are normalized with exact source retained in the backup; OpenCode JSONC comments are preserved. Writes use owner-only permissions on POSIX systems.

## Separate settings

Each setup writes backend connections, policy, and registrations to its own file:

| Harness | POSIX default |
| --- | --- |
| Pi | `~/.config/dataveil/pi/config.json` |
| OpenCode | `~/.config/dataveil/opencode/config.json` |
| Codex | `~/.config/dataveil/codex/config.json` |

`XDG_CONFIG_HOME` replaces `~/.config`; Windows uses `%APPDATA%`. `--settings FILE` or `DATAVEIL_CONFIG_FILE` overrides the settings destination. Use a different override for each harness. Setup refuses a settings file already registered to another harness. `--config FILE` independently overrides the native harness destination.

Personal native harness files (`opencode.json`/`opencode.jsonc`, `.pi/`, `.codex/`) and local connection files are ignored by Git. Harness registrations contain a launcher and saved-connection reference; backend executables, Oracle saved-connection arguments, and policy remain in DataVeil’s own settings file. Installing the Pi package loads its extension and skill; `/dataveil setup` creates connection settings.

Each generated launcher includes absolute Node, proxy, and settings paths with `--connection NAME --settings FILE`. Settings load on reconnect. Rerunning setup can reuse a saved connection within the same harness. `status --harness pi`, `status --harness opencode`, and `status --harness codex` inspect each harness; `status` inspects all three separate files. Saved configuration does not establish live protection.

Former shared `~/.config/dataveil/config.json` files are not automatically rewritten or deleted. Existing launchers continue to read their explicit path. Rerun each harness's setup with its default settings destination and confirm replacement of the native entry to separate those registrations. Remove an inherited `DATAVEIL_CONFIG_FILE` override before doing so.

## Standalone package

```sh
npm pack --workspace @dataveil/mcp-proxy
npm install -g ./dataveil-mcp-proxy-0.1.0.tgz
dataveil setup --harness codex
```

Use `dataveil` instead of the Node/script pair after installation. Registry publication has not been verified. The standalone proxy package includes the three configuration adapters; Pi's extension and skill belong to the separate checkout package under `harnesses/pi`.

## Direct proxy and gateway

```sh
node ./dataveil-mcp-proxy/src/index.js --command /absolute/path/to/backend --arg server-specific-argument
node ./dataveil-mcp-proxy/src/index.js --gateway
```

Gateway profiles are a JSON object with `connections`, mapping each name to a backend `command` and `args`. Pi reads `~/.config/dataveil/pi/profiles.json`, beside its settings file, respecting XDG and settings overrides. The standalone gateway defaults to `~/.config/dataveil/profiles.json`, respecting XDG/Windows settings roots. `DATAVEIL_PROFILES_FILE` overrides either path. Keep connection profiles in DataVeil’s config directory for the chosen harness. Gateway tools are `dataveil_connect`, `dataveil_disconnect`, and `dataveil_status`; backend tools appear after selection. Backend connection tools may still be needed to establish a database session.

Direct proxy defaults to `redact`; gateway to `block`. `--mode` overrides `DATAVEIL_PII_MODE`; `DATAVEIL_ENABLED=false` disables gateway protection. Direct proxy sanitization remains enabled. Defaults are a 16 MiB message limit and 120-second backend timeout. Malformed, oversized, or incomplete MCP output fails closed. Run `--help` for options.

Detection is heuristic; metadata is preserved rather than sanitized. Direct database protocols and remote HTTP MCP are unsupported. No license has been granted; package metadata is `UNLICENSED`.
