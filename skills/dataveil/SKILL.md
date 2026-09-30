# DataVeil Privacy Proxy

DataVeil is a database-agnostic privacy proxy for stdio MCP servers. It intercepts MCP `tools/call` results and redacts sensitive data (PII, credentials, emails, SSNs, phone numbers, addresses) before they reach the AI agent.

## When to use DataVeil

ALWAYS use DataVeil when connecting to a database through an MCP server. Never configure a raw database MCP server without DataVeil in between.

## Architecture

```
AI Agent (pi) → DataVeil Proxy → Database MCP Server (SQLcl, psql, etc.) → Database
```

DataVeil operates at the MCP JSON-RPC layer, not the database protocol layer. This makes it work with Oracle, PostgreSQL, MySQL, SQLite, or any stdio MCP backend.

## Setup

### For new database connections

Ask the user to run the interactive setup command:

```bash
/dataveil setup
```

This command:
1. Detects installed database MCP backends (SQLcl, psql, sqlite3, etc.)
2. Prompts for a saved connection or configuration
3. Writes the MCP configuration with DataVeil wrapping the backend
4. Requires `/reload` or a new session to activate

### For existing raw database MCP servers

If you detect a raw database MCP server already configured (e.g., one pointing directly at `sql` or `psql` without DataVeil), warn the user:

> "The database MCP server `[name]` is not protected by DataVeil. Run `/dataveil setup` to add privacy redaction, or ask me to migrate the configuration."

### For gateway mode (multi-database)

Use gateway mode when the user needs to switch between multiple database connections:

```bash
/dataveil gateway
```

Requirements:
1. A `dataveil-profiles.json` file in the project root with named connection profiles
2. The gateway exposes `dataveil_connect`, `dataveil_disconnect`, and `dataveil_status` tools
3. Backend tools only appear after `dataveil_connect` is called with a profile name
4. Gateway defaults to `block` mode (withholds entire result if PII detected)

Example `dataveil-profiles.json`:

```json
{
  "connections": {
    "prod_oracle": {
      "command": "/path/to/sqlcl/bin/sql",
      "args": ["-name", "production", "-mcp"],
      "connectTool": "connect"
    },
    "dev_postgres": {
      "command": "psql-mcp-server",
      "args": ["--connection-string", "postgres://dev@localhost/devdb"]
    }
  }
}
```

## Configuration rules

When writing or editing `~/.pi/agent/mcp.json` or `.pi/mcp.json`:

- **NEVER** write a raw database server command directly. Always wrap through DataVeil.
- The `command` field should be `node` with the DataVeil `index.js` path in `args`.
- The backend command goes in `--command` and backend args in repeated `--arg` options.
- Set `DATAVEIL_PII_MODE` to `redact` (replace values in place) or `block` (withhold entire result).
- Set `DATAVEIL_BACKEND_TIMEOUT_MS` to `120000` (default) or adjust as needed.

Example configuration:

```json
{
  "mcpServers": {
    "oracle": {
      "command": "node",
      "args": [
        "/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js",
        "--command", "/path/to/sqlcl/bin/sql",
        "--arg", "-name",
        "--arg", "dataveil_ai",
        "--arg", "-mcp"
      ],
      "env": {
        "DATAVEIL_PII_MODE": "redact",
        "DATAVEIL_BACKEND_TIMEOUT_MS": "120000"
      },
      "exposure": "codemode"
    }
  }
}
```

## What gets redacted

DataVeil scans tool results recursively and redacts:

- Oracle-style connect strings (`user/password@host:port/service`)
- Credential assignments (`password=...`, `secret=...`, API tokens)
- Email addresses
- US Social Security numbers
- Phone numbers
- IPv4 addresses
- Values under known sensitive column names: `EMAIL`, `SSN`, `PHONE`, `FIRST_NAME`, `LAST_NAME`, `ADDRESS`, `PASSWORD`, `TOKEN`, and similar
- Sensitive values in CSV-like text when headers contain known sensitive columns

## Modes

- **Redact** (default): Replaces sensitive values with `[REDACTED_PII]` and returns the rest of the result.
- **Block**: Withholds the entire tool result if any sensitive data is detected. Returns an error message explaining that sensitive data was blocked.

Use `block` mode for production databases with strict compliance requirements. Use `redact` for development and troubleshooting where the structure of results still matters.

## Backward compatibility

DataVeil preserves backward compatibility with Oracle SQLcl:

- `DATAVEIL_SQLCL` and `SECURE_ORACLE_SQLCL` environment variables
- `--sqlcl` and `--sqlcl-arg` CLI options
- Auto-adds `-mcp` when SQLcl is detected with no arguments

## Important notes

- DataVeil only controls MCP traffic. Direct database connections outside MCP are not protected.
- It is not a replacement for database permissions or least-privilege accounts.
- Messages over `--max-message-bytes` (default 16 MiB), malformed JSON, or incomplete messages cause fail-closed behavior.
- Backend stderr is also sanitized before DataVeil writes it locally.
- Always keep database credentials in the backend MCP server's normal secret store or wallet. Do not paste credentials into agent chat.
