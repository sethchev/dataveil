# DataVeil

DataVeil is a database-agnostic privacy proxy for stdio MCP servers. It sits between an MCP client and any MCP backend, forwarding JSON-RPC messages unchanged except for one deliberate behavior: sensitive data is removed from MCP `tools/call` results before those results are returned to the client.

In short: point your MCP client at DataVeil, point DataVeil at your database MCP server, and the agent sees the same tools with locally redacted results.

## Why this exists

Database MCP servers are powerful because they expose database inspection and query tools directly to AI agents. That is useful, but tool results may contain names, emails, addresses, credentials, tokens, or other sensitive values.

DataVeil provides a local MCP-only privacy layer. It does not need to know whether the backend is Oracle, PostgreSQL, MySQL, SQLite, or something else, because it works at the MCP message layer rather than the database protocol layer.

## Architecture

```text
MCP client
   │
   │ JSON-RPC over stdio
   ▼
DataVeil MCP proxy
   │
   │ JSON-RPC over stdio
   ▼
Any stdio MCP backend
   │
   ▼
Database or service
```

DataVeil is transparent to the MCP client:

- Client requests are forwarded to the backend MCP server.
- Backend responses are forwarded back to the client.
- MCP tool names, descriptions, schemas, and metadata are preserved.
- Only responses to `tools/call` requests are sanitized.
- Backend stderr is sanitized before DataVeil writes it locally.

## What gets redacted

DataVeil recursively scans structured values and text returned by backend MCP tool calls. It currently redacts:

- Oracle-style connect strings
- Credential assignments such as `password=...`, `secret=...`, and API tokens
- Email addresses
- US Social Security numbers
- Phone numbers
- IPv4 addresses
- Values under common sensitive field or column names, including `EMAIL`, `SSN`, `PHONE`, `FIRST_NAME`, `LAST_NAME`, `ADDRESS`, `PASSWORD`, and `TOKEN`
- Sensitive values in CSV-like result text when the header contains known sensitive column names

Default behavior is in-place redaction. For stricter environments, block mode withholds an entire sensitive tool result.

## MCP-only scope

DataVeil only controls data returned through MCP. It is intentionally database-agnostic and does not parse database protocols directly. Both direct proxy and gateway mode use the same MCP message framing and tool-result sanitizer. Messages over `--max-message-bytes` (default 16 MiB), malformed JSON, and incomplete messages fail closed: direct mode stops the proxy; gateway mode disconnects the offending backend and returns an error for pending calls. A backend that does not respond within `--backend-timeout-ms` (default 120 seconds) is terminated. Redaction/blocking still applies only to backend `tools/call` results, not tool metadata.

It does not manage direct, non-MCP database access paths, and it is not a replacement for backend permissions or least-privilege database accounts. Its job is to sanitize MCP tool results before an AI agent receives them.

## Repository layout

- `dataveil-mcp-proxy/` — the stdio MCP privacy proxy
- `test/` — fake MCP backend and behavioral proxy/redaction tests
- `docs/install.md` — installation and configuration notes
- `.mcp.json` — example local MCP configuration

## Requirements

- Node.js 20 or newer
- A stdio MCP backend server, such as an Oracle, PostgreSQL, MySQL, SQLite, or other database MCP server
- An MCP client that can launch stdio servers

## Install and test

```bash
git clone https://github.com/sethchev/dataveil.git
cd dataveil
npm install
npm run build
npm test
```

## Configure a generic MCP backend

Use `DATAVEIL_COMMAND` or `--command` to choose the backend MCP server executable. Pass backend arguments with repeated `--arg` options.

```bash
node ./dataveil-mcp-proxy/src/index.js \
  --command /path/to/mcp-server \
  --arg first-backend-arg \
  --arg second-backend-arg
```

Equivalent environment variable form:

```bash
DATAVEIL_COMMAND=/path/to/mcp-server \
  node ./dataveil-mcp-proxy/src/index.js --arg first-backend-arg
```

Keep database credentials in the backend MCP server's normal local configuration, environment variables, wallet, or secret store. Do not paste credentials into agent chat.

## MCP client configuration example

```json
{
  "mcpServers": {
    "database": {
      "command": "node",
      "args": [
        "./dataveil-mcp-proxy/src/index.js",
        "--command",
        "/path/to/database-mcp-server",
        "--arg",
        "server-specific-argument"
      ],
      "env": {
        "DATAVEIL_PII_MODE": "redact"
      }
    }
  }
}
```

After restarting the MCP client, the backend MCP tools are available through DataVeil.

## Set up the DataVeil gateway

1. Install dependencies as shown above. Make sure the database MCP server works separately and keep its database credentials in its own secret store or saved connection, **not** in DataVeil's profile file.
2. Create `dataveil-profiles.json` in the repository root (this local file is gitignored) with a named stdio backend:

   ```json
   {
     "connections": {
       "my_database": {
         "command": "/absolute/path/to/database-mcp-server",
         "args": []
       }
     }
   }
   ```

   For a backend that has a `connect` MCP tool accepting `connection_name`, add `"connectTool": "connect"` to the profile to have the gateway call it with `my_database`. Otherwise connect through the backend's own tools after selecting the profile. The profile name and backend's saved connection name must match when using `connectTool`.
3. Configure your MCP client to launch DataVeil (the included `.mcp.json` is an example). Replace `/absolute/path/to/dataveil` with your checkout location; absolute paths work regardless of the client's working directory:

   ```json
   {
     "mcpServers": {
       "dataveil": {
         "command": "node",
         "args": ["/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js", "--gateway"],
         "env": {
           "DATAVEIL_PROFILES_FILE": "/absolute/path/to/dataveil/dataveil-profiles.json"
         }
       }
     }
   }
   ```

4. Restart the MCP client. Call `dataveil_connect` with `{ "name": "my_database" }`; then call `dataveil_status` to confirm `connected: true` and `protected: true`. The selected backend's tools become available through DataVeil. Use `dataveil_disconnect` before switching or ending the connection.

The gateway defaults to `block`: when a sensitive value is detected in a tool result, the entire result is withheld. Set `DATAVEIL_PII_MODE=redact` in the MCP client's `env` to replace detected values in place instead. `DATAVEIL_ENABLED=false` explicitly disables protection; do not set it for protected use. The gateway now applies the same message-size limit, framing checks, and sanitization as direct proxy mode; invalid backend output disconnects that backend rather than forwarding it.

### Oracle SQLcl gateway example

If SQLcl already has a saved connection named `dataveil_ai`, a local profile can launch its MCP mode with that name:

```json
{
  "connections": {
    "dataveil_ai": {
      "command": "/absolute/path/to/sqlcl/bin/sql",
      "args": ["-name", "dataveil_ai", "-mcp"]
    }
  }
}
```

Select it using `dataveil_connect` with `{ "name": "dataveil_ai" }`. If SQLcl exposes its own `connect` tool and its database session is not yet connected, call that tool with the saved connection name before querying. Do not assume selecting a gateway profile alone establishes a database session.

## Oracle SQLcl compatibility

SQLcl remains supported as one backend example. For backward compatibility, DataVeil still accepts:

- `DATAVEIL_SQLCL`
- `SECURE_ORACLE_SQLCL`
- `--sqlcl`
- `--sqlcl-arg`

If no backend arguments are provided and SQLcl is discovered through the compatibility path, DataVeil automatically adds `-mcp`.

```bash
DATAVEIL_SQLCL=/path/to/sqlcl/bin/sql \
  node ./dataveil-mcp-proxy/src/index.js
```

MCP client example:

```json
{
  "mcpServers": {
    "oracle": {
      "command": "node",
      "args": ["./dataveil-mcp-proxy/src/index.js"],
      "env": {
        "DATAVEIL_PII_MODE": "redact",
        "DATAVEIL_SQLCL": "/path/to/sqlcl/bin/sql"
      }
    }
  }
}
```

## Redact vs. block mode

Redact mode replaces sensitive values and returns the rest of the tool result:

```bash
DATAVEIL_PII_MODE=redact node ./dataveil-mcp-proxy/src/index.js --command /path/to/mcp-server
```

Block mode withholds the entire tool result when sensitive data is detected:

```bash
DATAVEIL_PII_MODE=block node ./dataveil-mcp-proxy/src/index.js --command /path/to/mcp-server
```

## CLI options

```text
Usage: dataveil-mcp-proxy [options]

Options:
  --command PATH            MCP backend command to launch
  --arg ARG                 Backend argument; repeat as needed
  --mode redact|block       Redact fields or block sensitive tool results
  --max-message-bytes N     Maximum MCP JSON message size (default: 16777216)
  --backend-timeout-ms N    Backend response timeout (default: 120000)
  --gateway                 Run the DataVeil MCP gateway
  --help                    Show help

Backward-compatible Oracle SQLcl options:
  --sqlcl PATH              Alias for --command
  --sqlcl-arg ARG           Alias for --arg
```

## Pi extension (interactive setup)

DataVeil includes a Pi coding-agent extension in `extensions/dataveil.ts` that provides interactive commands for configuring and monitoring DataVeil.

### `/dataveil setup`

Interactive setup that:
1. **Auto-discovers database MCP backends** via your shell `PATH` and common install locations (`/opt/homebrew/bin`, `~/Downloads/sqlcl/bin`, `~/sqlcl/bin`, etc.)
2. **Prompts for a connection name** (e.g. `prod_oracle`, `dev_postgres`) — you choose the MCP server name instead of auto-generated keys
3. **Lists saved SQLcl connections** via `connmgr list` and lets you pick one
4. **Writes the config** to `~/.pi/agent/mcp.json` or `.pi/mcp.json`

Example walkthrough in TUI mode:
```
Connection name: prod_oracle
Select a database backend to protect with DataVeil:
  Oracle SQLcl (/home/seth/Downloads/sqlcl/bin/sql)
Choose a saved SQLcl connection: dataveil_ai
Save configuration to: Global (~/.pi/agent/mcp.json)

DataVeil configured: server "prod_oracle" → Oracle SQLcl.
Run /reload or start a new session to connect.
```

### `/dataveil status`

Shows which MCP servers are protected by DataVeil and which are raw (unprotected). Scans both global and project `mcp.json` files:

```
🔒 DataVeil Privacy Proxy Status

📁 Global (~/.pi/agent/mcp.json)
   ✅ oracle  → DataVeil (redact mode)  backend: /home/seth/Downloads/sqlcl/bin/sql

Summary: 1 protected, 0 unprotected database MCP server(s)
```

- ✅ = protected by DataVeil (shows PII mode and backend path)
- ⚠️ = raw database server with no privacy proxy

### `/dataveil gateway`

Registers DataVeil gateway mode for multi-database projects. Requires a `dataveil-profiles.json` file in the project root.

### Session notifications

On every session start, the extension:
- Shows an **info notification** if DataVeil is actively protecting server(s)
- Shows a **warning notification** if any raw (unprotected) database MCP servers are detected

## Development

```bash
npm run build
npm test
```

The test suite uses a fake generic MCP backend and verifies proxy behavior, gateway connection and tool forwarding, JSON-RPC forwarding, redaction, block mode plumbing, stderr sanitization, and fail-closed configuration validation.

## License

No license has been added yet. All rights reserved unless a license is added later.
