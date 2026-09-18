# DataVeil

DataVeil is a local privacy proxy for Oracle SQLcl MCP. It lets an AI agent use Oracle's existing SQLcl MCP tools while redacting sensitive data before tool results are returned to the agent.

The current repository contains one working component:

- `dataveil-sqlcl-mcp-proxy/` — a transparent stdio MCP proxy that starts SQLcl in MCP mode, forwards MCP requests and responses, and sanitizes `tools/call` results locally.

## What it does

DataVeil sits between an MCP client and Oracle SQLcl MCP:

```text
MCP client  <->  DataVeil proxy  <->  SQLcl -mcp  <->  Oracle Database
```

It preserves SQLcl MCP tool names and schemas, so existing MCP clients can keep using the Oracle tools they already know. When SQLcl returns a tool result, DataVeil recursively scans the result and redacts common sensitive values before the client receives it.

Redaction currently covers:

- Oracle connect strings
- Credential assignments such as `password=...`, `secret=...`, and API tokens
- Email addresses
- US Social Security numbers
- Phone numbers
- IPv4 addresses
- Values under common sensitive column names in structured objects and CSV output, such as `EMAIL`, `SSN`, `PHONE`, `FIRST_NAME`, `LAST_NAME`, `ADDRESS`, `PASSWORD`, and `TOKEN`

SQLcl stderr is also sanitized before it is written by the proxy.

## What it does not do

DataVeil is a privacy guardrail, not a database authorization system.

- It does not restrict which SQL statements SQLcl MCP can execute.
- It does not replace Oracle grants, roles, views, row-level security, or auditing.
- It does not guarantee perfect PII detection.
- It does not redact MCP metadata such as tool descriptions; it sanitizes tool-call results.

For defense in depth, use a least-privilege Oracle account and prefer sanitized views over direct access to raw PII tables.

## Requirements

- Node.js 20 or newer
- Oracle SQLcl with MCP support
- A local MCP client configuration that can start a stdio server

## Install and test

```bash
git clone https://github.com/sethchev/dataveil.git
cd dataveil
npm install
npm run build
npm test
```

## Configure SQLcl discovery

DataVeil discovers SQLcl in this order:

1. `--sqlcl /path/to/sql`
2. `DATAVEIL_SQLCL`
3. `SECURE_ORACLE_SQLCL`
4. `sql` on `PATH`
5. the newest `~/Downloads/sqlcl-*/sqlcl/bin/sql`

Example:

```bash
export DATAVEIL_SQLCL=/path/to/sqlcl/bin/sql
```

Keep database credentials in SQLcl saved connections, Oracle Wallet, environment variables, or another local secret store. Do not paste credentials into agent chat.

## Run as an MCP server

```bash
DATAVEIL_SQLCL=/path/to/sqlcl/bin/sql \
  node ./dataveil-sqlcl-mcp-proxy/src/index.js
```

By default, DataVeil starts SQLcl with `-mcp`. You can pass additional child arguments with repeated `--sqlcl-arg` options.

## Pi MCP configuration example

This repository includes an example `.mcp.json` that starts the proxy as an `oracle` MCP server:

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

After restarting the MCP client, SQLcl MCP tools are available through the configured server. Use SQLcl saved connection names as usual.

## Redact vs. block mode

The default mode redacts sensitive values in-place:

```bash
DATAVEIL_PII_MODE=redact node ./dataveil-sqlcl-mcp-proxy/src/index.js
```

Block mode withholds an entire sensitive tool result instead:

```bash
DATAVEIL_PII_MODE=block node ./dataveil-sqlcl-mcp-proxy/src/index.js
```

## CLI options

```text
Usage: dataveil-sqlcl-mcp-proxy [options]

Options:
  --sqlcl PATH              SQLcl executable (auto-discovered by default)
  --sqlcl-arg ARG           Child argument; repeat as needed (default: -mcp)
  --mode redact|block       Redact fields or block sensitive tool results
  --max-message-bytes N     Maximum MCP JSON message size (default: 16777216)
  --help                    Show help
```

## Development

```bash
npm run build
npm test
```

The test suite uses a fake SQLcl MCP process and verifies proxy behavior, JSON-RPC forwarding, redaction, block mode plumbing, stderr sanitization, and fail-closed configuration validation.

## License

No license has been added yet. All rights reserved unless a license is added later.
