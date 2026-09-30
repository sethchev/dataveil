# Install and configure DataVeil

DataVeil routes any stdio MCP agent → DataVeil → any stdio MCP backend → database or service. It sanitizes `tools/call` results and backend stderr. It does not proxy direct database protocols or remote HTTP MCP.

## Local installation

Registry publication has not been verified. Use a local checkout:

```sh
git clone https://github.com/sethchev/dataveil.git
cd dataveil
npm install
npm run build
npm test
node ./dataveil-mcp-proxy/src/index.js --help
```

Or pack the standalone proxy and install that local tarball:

```sh
npm pack --workspace @dataveil/mcp-proxy
npm install -g ./dataveil-mcp-proxy-0.1.0.tgz
dataveil --help
```

After an authorized registry release, the equivalent scoped install is `npm install -g @dataveil/mcp-proxy`, and no-install execution is `npx --yes --package @dataveil/mcp-proxy dataveil --help`. These registry commands are not verified release instructions today.

## Shared wizard

From a checkout:

```sh
node ./dataveil-mcp-proxy/src/index.js setup --harness cursor
node ./dataveil-mcp-proxy/src/index.js --configure --harness generic --config /absolute/path/to/mcp.json
node ./dataveil-mcp-proxy/src/index.js status --harness generic --config /absolute/path/to/mcp.json
```

After local tarball installation use `dataveil` in place of `node ./dataveil-mcp-proxy/src/index.js`.

Setup detects the harness from inherited session/terminal markers when available, then asks you to confirm or choose another harness. It then prompts for destination, database, that database’s stdio MCP backend, privacy mode, and MCP entry name. Oracle SQLcl MCP is the first database option; PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, and Other follow. Non-Oracle selections offer an installed MCP executable, an MCP package via `npx`, or an MCP package via `uvx`, followed by backend arguments as a JSON string array. The runner must already be installed, and the user supplies their preferred package. Setup does not run or download those packages; the harness launches them when connecting.

SQLcl can use a separately named saved connection; manual names may include spaces or punctuation. Codex session markers identify Codex; OpenCode sets `OPENCODE=1` and `OPENCODE_PID`, which identify OpenCode before editor markers; Cursor, Windsurf and VS Code terminal markers identify the editor. Pi supplies its harness context through the extension. If the caller cannot be identified, setup asks you to choose. An explicit `--harness` selects the candidate and still prompts for confirmation. Oracle discovery searches `DATAVEIL_SQLCL` (explicit executable), `SQLCL_HOME/bin/sql`, inherited PATH (`sql`/`sqlcl`), then common installation roots such as `~/Downloads/sqlcl`, `~/sqlcl`, `~/tools/sqlcl`, `~/.local/share/sqlcl`, `/opt/sqlcl`, `/opt/oracle/sqlcl`, `/usr/local/sqlcl`, `/usr/share/sqlcl`, and `$ORACLE_HOME/sqlcl`. It checks `bin/sql` and nested `sqlcl/bin/sql` (Windows uses `sql.exe` and also checks `%ProgramFiles%/Oracle/sqlcl`). A found executable is used automatically and its path is shown in the saved-connection prompt; only failed discovery asks for a path. SQLcl receives `-mcp` automatically.

Custom stdio MCP backends remain available for every other database choice. **Raw `psql`, `sqlite3`, `mysql`, and `mariadb` are database clients, not MCP servers.** Use a separate MCP backend for those databases.

Cancel any prompt to exit without saving. Existing files must contain valid TOML for Codex, JSON/JSONC for OpenCode, or strict JSON with the correct schema for other harnesses. OpenCode comments and unrelated settings are preserved through targeted entry edits. JSONC is refused for other JSON adapters. Codex TOML is reserialized: setting values and unrelated MCP entries are preserved, while comments and formatting are normalized. The backup retains the exact original source. Unrelated settings are preserved. Replacing a duplicate name requires explicit confirmation. Writes are atomic and existing files receive a unique `.bak-…` backup; file and backup permissions are restricted to the owner on POSIX systems. Setup requires an interactive terminal and does not configure defaults from piped input.

Generated launchers use the resolved Node executable and absolute proxy/shared settings paths. Keep that Node installation and checkout or installed package available. Backend arguments should use absolute paths if the backend needs local files. Keep passwords in backend credential stores or inherited environment variables; never paste secrets into chat or the wizard's argument prompt. The wizard does not collect credentials.

## Shared settings across harnesses

Setup stores connections and all configured harness registrations in one DataVeil settings file: `~/.config/dataveil/config.json` on macOS/Linux (`$XDG_CONFIG_HOME/dataveil/config.json` when set), or `%APPDATA%/dataveil/config.json` on Windows. Override it with `DATAVEIL_CONFIG_FILE` or `--settings /absolute/path/to/config.json`.

Each client still needs its own native MCP registration because client schemas differ. The wizard creates that registration automatically, pointing to a shared connection using `--connection NAME --settings FILE`. Adding a harness retains previous registrations and files. No client reads another client's JSON or TOML configuration.

To use the same connection in Codex and Cursor:

```sh
dataveil setup --harness codex
dataveil setup --harness cursor
dataveil status
```

Create a backend on the first run; on the second, choose the existing **Shared DataVeil connection**. Each run confirms the harness and destination. Repeat for any other supported harness, including ones requiring explicit native config paths. This registers the harnesses you choose; it does not blindly write files for applications that may not be installed.

An example shared file after setup (paths are placeholders):

```json
{
  "version": 1,
  "connections": {
    "database": {
      "command": "/absolute/path/to/database-mcp-server",
      "args": [],
      "mode": "redact"
    }
  },
  "harnesses": [
    {
      "harnessKey": "codex",
      "configPath": "/absolute/path/to/codex/config.toml",
      "name": "database",
      "connection": "database"
    },
    {
      "harnessKey": "cursor",
      "configPath": "/absolute/path/to/cursor/mcp.json",
      "name": "database",
      "connection": "database"
    }
  ]
}
```

Connections and registrations are saved together after final confirmation, with file backups and checks for concurrent edits. Setup writers use a shared lock; ordinary native-config save failures restore the prior shared settings. Cancellation writes neither config. A failed setup process can leave a `.lock` file; remove it only after verifying no setup process is still saving.

All configured harnesses can run simultaneously. Each launches its own stdio proxy/backend session and reads the same connection settings on startup. Changes to a shared connection apply after restart/reconnect; running sessions do not automatically reload policy. Updating a backend or policy therefore does not require rewriting every client registration. Existing direct `--command` configurations remain supported and can be migrated by rerunning setup with replacement confirmation.

`dataveil status` includes saved registrations outside the current working directory and reads their shared policy. CLI `--mode` and `DATAVEIL_PII_MODE` can still override a connection's saved mode.

## Harness locations and schemas

These adapters generate stdio entries. Config-file support does not establish that a harness is installed, running, or routing calls through DataVeil.

| `--harness` | Destination | Root field |
| --- | --- | --- |
| `codex` | Choose global `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) or project `.codex/config.toml` | TOML `mcp_servers` |
| `opencode` | Choose global `~/.config/opencode/opencode.json` / `opencode.jsonc` (respects `XDG_CONFIG_HOME`), project `opencode.json` / `opencode.jsonc`, or inherited `OPENCODE_CONFIG` path | `mcp`, entry `type: "local"`, `command` array |
| `claude-desktop` | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows `%APPDATA%/Claude/claude_desktop_config.json`; explicit path elsewhere | `mcpServers` |
| `cursor` | Choose global `~/.cursor/mcp.json` or project `.cursor/mcp.json` | `mcpServers` |
| `windsurf` | Existing legacy `~/.codeium/windsurf/mcp_config.json`, or explicit path opened in the application's MCP UI | `mcpServers` |
| `vscode` | Project `.vscode/mcp.json` | `servers`, entry `type: "stdio"` |
| `cline` | Explicit `cline_mcp_settings.json` path opened through Cline's MCP configuration UI | `mcpServers` |
| `pi` | Choose global `~/.pi/agent/mcp.json` or project `.pi/mcp.json` | `mcpServers` |
| `generic` | Explicit path or select project `mcp.json` | `mcpServers` |

`--config FILE` overrides the native harness destination; `--settings FILE` selects the shared DataVeil settings file. Otherwise setup prompts for scope/path instead of inferring scope from existing files. Cline never defaults to VS Code's native file.

References: [OpenCode configuration](https://opencode.ai/docs/config/), [OpenCode MCP](https://opencode.ai/docs/mcp-servers/), [OpenCode session markers](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/index.ts), [Codex CLI](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude Desktop](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [Cursor](https://prod.cursor.com/help/customization/mcp), [VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [Cline](https://docs.cline.bot/mcp/mcp-overview). Pi's installed 0.99.1 `docs/mcp.md`, `docs/extensions.md`, and `docs/packages.md` document its paths and extension APIs.

The [former Windsurf documentation](https://docs.windsurf.com/windsurf/cascade/mcp) now redirects to Devin Desktop, whose Cascade configuration uses different paths. This adapter deliberately requires an explicit path when the legacy file does not exist; it does not claim Devin Local support.

## Manual configuration for each harness

For Claude Desktop, Cursor, legacy Windsurf, Cline, Pi, and generic clients, save this under the `mcpServers` field at the selected location above. Replace all executable/file placeholders with actual absolute paths:

```json
{
  "mcpServers": {
    "database": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js",
        "--command", "/absolute/path/to/database-mcp-server",
        "--arg", "server-specific-argument"
      ],
      "env": { "DATAVEIL_PII_MODE": "redact" }
    }
  }
}
```

Codex uses TOML rather than the JSON examples above. The wizard writes this shape to the chosen `config.toml`:

```toml
[mcp_servers.database]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js", "--command", "/absolute/path/to/database-mcp-server"]

[mcp_servers.database.env]
DATAVEIL_PII_MODE = "redact"
```

From a checkout, run `node ./dataveil-mcp-proxy/src/index.js setup` and confirm the detected harness or select **Codex CLI**, or pass `setup --harness codex` and confirm it. Choose global or project scope; `--config /absolute/path/to/config.toml` overrides both. Project config follows Codex's project-trust rules. Run `codex mcp get database --json` to inspect the generated entry, then restart Codex and use `/mcp` to inspect the runtime connection. CLI acceptance of the config is tested; a real Codex tool call is still not claimed by that check.

The wizard's shared launcher uses `args = ["/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js", "--connection", "database", "--settings", "/absolute/path/to/dataveil/config.json"]` in Codex TOML, the same string array under `args` in other JSON clients, or appended to the executable in OpenCode’s `command` array. Backend executable, backend arguments and default mode are held in the shared file above.

VS Code's `.vscode/mcp.json` instead uses:

```json
{
  "servers": {
    "database": {
      "type": "stdio",
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js",
        "--command", "/absolute/path/to/database-mcp-server"
      ],
      "env": { "DATAVEIL_PII_MODE": "redact" }
    }
  }
}
```

For SQLcl, replace backend command/arguments with `"--command", "/absolute/path/to/sqlcl/bin/sql", "--arg", "-name", "--arg", "demo_saved_connection", "--arg", "-mcp"`. SQLcl's MCP mode is a backend; a raw SQL session is not.

Restart/reload the client after editing. Use its MCP UI to confirm discovery and make a synthetic query before relying on the route. Adapter schema tests and independent client tests do not constitute real desktop UI testing.

## Pi extension

From the checkout, load the extension with `pi --extension ./extensions/dataveil.ts`, or install the root Pi package locally with `pi install /absolute/path/to/dataveil`.

- `/dataveil setup` delegates to the shared wizard through `ctx.ui`, then asks you to `/reload`.
- `/dataveil status` reports saved configuration and policy, not runtime protection.
- `/dataveil gateway` registers a session-only gateway using `dataveil-profiles.json` in the session's working directory.

Cancelled or non-UI setup never writes automatic defaults. The extension does not make startup claims that protection is active.

## Gateway and policy

Direct proxy defaults to `redact`; gateway defaults to `block`. `--mode` overrides `DATAVEIL_PII_MODE`. `DATAVEIL_ENABLED=false` disables gateway protection. Direct proxy always sanitizes results regardless of that gateway setting.

Launch the gateway using `dataveil --gateway` or the `dataveil-gateway` executable. Configure its `DATAVEIL_PROFILES_FILE` as an absolute path to a local JSON file:

```json
{
  "connections": {
    "demo": {
      "command": "/absolute/path/to/database-mcp-server",
      "args": []
    }
  }
}
```

For manual MCP configuration, use the same harness schema above with proxy args `["/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js", "--gateway"]` and env `{"DATAVEIL_PROFILES_FILE":"/absolute/path/to/profiles.json"}`.

Gateway tools: `dataveil_connect` selects a profile by `name`; `dataveil_disconnect` closes it; `dataveil_status` reports the gateway's current routing and policy. Backend tools become available after selection. Selecting a profile does not necessarily establish a database session; use backend connection tools as needed. An optional profile `connectTool` is called with `connection_name` equal to the profile name by default, so those names must match when using that feature.

CLI status reads saved configs only. Gateway runtime status describes the gateway's connection and enabled policy; it does not verify that every field is sanitized or that all database access uses the gateway.

## Limits and license

Redaction is heuristic: unknown sensitive fields may be missed and harmless values may be replaced. Block mode withholds results containing detected sensitive data; it is subject to the same detection limits. Tool metadata is preserved, not sanitized. No direct database protocol or remote HTTP MCP protection is implemented. Backend permissions and least privilege remain necessary.

Malformed, oversized, or incomplete MCP output fails closed. Backend response timeout defaults to 120000 ms and message-size limit to 16 MiB. Inspect `dataveil --help` for proxy and SQLcl compatibility options.

No license has been granted. Package metadata is `UNLICENSED`; all rights reserved. No registry publication or license change is part of this implementation.

### OpenCode

Run `dataveil setup --harness opencode` and confirm OpenCode, or run setup from an OpenCode shell session and confirm the detected harness. Select global/project JSON or JSONC, or use `--config /absolute/path/to/opencode.jsonc`. Reuse an existing shared connection to keep the same backend and policy across harnesses. The native registration is:

```json
{
  "mcp": {
    "database": {
      "type": "local",
      "command": [
        "/absolute/path/to/node",
        "/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js",
        "--connection", "database",
        "--settings", "/absolute/path/to/dataveil/config.json"
      ],
      "enabled": true
    }
  }
}
```

Run `opencode mcp list` to inspect the connection. The isolated installed-CLI smoke test connects to a synthetic backend; it does not establish a real database tool call through the OpenCode UI.
