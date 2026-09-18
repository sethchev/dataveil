# Install and use DataVeil

DataVeil is currently a local privacy proxy for Oracle SQLcl MCP. It starts SQLcl in MCP mode and redacts sensitive values from SQLcl MCP tool-call results before they reach the MCP client.

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

## 3. Configure SQLcl locally

Point DataVeil at your SQLcl executable. Use one of these options:

```bash
export DATAVEIL_SQLCL=/path/to/sqlcl/bin/sql
```

or pass the executable explicitly:

```bash
node ./dataveil-sqlcl-mcp-proxy/src/index.js --sqlcl /path/to/sqlcl/bin/sql
```

DataVeil also checks `SECURE_ORACLE_SQLCL`, `sql` on `PATH`, and the newest `~/Downloads/sqlcl-*/sqlcl/bin/sql`.

Keep Oracle credentials local. Prefer SQLcl saved connections, Oracle Wallet, environment variables, or another local secret store. Do not paste credentials into agent chat.

## 4. Configure an MCP client

Example `.mcp.json`:

```json
{
  "mcpServers": {
    "oracle": {
      "command": "node",
      "args": ["./dataveil-sqlcl-mcp-proxy/src/index.js"],
      "env": {
        "DATAVEIL_PII_MODE": "redact"
      }
    }
  }
}
```

Restart your MCP client after changing configuration. SQLcl MCP tools are exposed through the configured server, with sensitive tool-call results redacted locally by DataVeil.

## 5. Choose redaction behavior

Redact values in-place:

```bash
DATAVEIL_PII_MODE=redact node ./dataveil-sqlcl-mcp-proxy/src/index.js
```

Withhold any sensitive tool result completely:

```bash
DATAVEIL_PII_MODE=block node ./dataveil-sqlcl-mcp-proxy/src/index.js
```

## Important limitations

DataVeil is not a SQL authorization boundary. SQLcl MCP can still run the SQL that the connected Oracle user is allowed to run. Use least-privilege database accounts and sanitized views for defense in depth.
