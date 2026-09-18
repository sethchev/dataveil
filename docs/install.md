# Install and use DataVeil

DataVeil is a database-agnostic privacy proxy for stdio MCP servers. It launches a configured MCP backend and redacts sensitive values from MCP `tools/call` results before they reach the MCP client.

## 1. Install dependencies

```bash
git clone https://github.com/sethchev/dataveil.git
cd dataveil
npm install
```

## 2. Build and test

```bash
npm run build
npm test
```

## 3. Configure a backend MCP server

Point DataVeil at the stdio MCP server you want to protect:

```bash
node ./dataveil-mcp-proxy/src/index.js \
  --command /path/to/database-mcp-server \
  --arg server-specific-argument
```

Or use an environment variable:

```bash
DATAVEIL_COMMAND=/path/to/database-mcp-server \
  node ./dataveil-mcp-proxy/src/index.js --arg server-specific-argument
```

DataVeil does not parse or proxy database protocols directly. It proxies MCP JSON-RPC messages and sanitizes backend `tools/call` results, so the same proxy can sit in front of Oracle, PostgreSQL, MySQL, SQLite, or any other stdio MCP server.

Keep database credentials in the backend MCP server's normal local configuration, environment variables, wallet, or secret store. Do not paste credentials into agent chat.

## 4. Configure an MCP client

Generic backend example:

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

Restart your MCP client after changing configuration. The backend MCP tools are exposed normally, with sensitive `tools/call` results redacted locally by DataVeil.

## 5. Oracle SQLcl compatibility

SQLcl remains supported as a backend example. You can configure it with the generic `--command` option:

```bash
node ./dataveil-mcp-proxy/src/index.js \
  --command /path/to/sqlcl/bin/sql \
  --arg -mcp
```

For backward compatibility, DataVeil also accepts `DATAVEIL_SQLCL`, `SECURE_ORACLE_SQLCL`, `--sqlcl`, and `--sqlcl-arg`. If no backend arguments are provided and SQLcl is discovered through this compatibility path, DataVeil adds `-mcp` automatically.

## 6. Choose redaction behavior

Redact values in-place:

```bash
DATAVEIL_PII_MODE=redact node ./dataveil-mcp-proxy/src/index.js --command /path/to/mcp-server
```

Withhold any sensitive tool result completely:

```bash
DATAVEIL_PII_MODE=block node ./dataveil-mcp-proxy/src/index.js --command /path/to/mcp-server
```

## Important scope note

DataVeil is MCP-only. It protects data returned through MCP tool results and does not manage direct, non-MCP database access paths.
