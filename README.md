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

DataVeil only controls data returned through MCP. It is intentionally database-agnostic and does not parse database protocols directly.

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
  --help                    Show help

Backward-compatible Oracle SQLcl options:
  --sqlcl PATH              Alias for --command
  --sqlcl-arg ARG           Alias for --arg
```

## Development

```bash
npm run build
npm test
```

The test suite uses a fake generic MCP backend and verifies proxy behavior, JSON-RPC forwarding, redaction, block mode plumbing, stderr sanitization, and fail-closed configuration validation.

## License

No license has been added yet. All rights reserved unless a license is added later.
