# @dataveil/mcp-proxy

Database-agnostic privacy proxy for stdio MCP servers. Sits between an MCP client (AI agent) and any MCP backend, redacting sensitive data from tool results before they reach the agent.

## Install

```bash
npm install -g @dataveil/mcp-proxy
```

Or use without installing:

```bash
npx -p @dataveil/mcp-proxy dataveil --command /path/to/mcp-server
```

## Quick start

```bash
# Proxy a single backend
dataveil --command /path/to/sqlcl/bin/sql --arg -mcp

# Run in gateway mode for multiple connections
dataveil --gateway

# Configure interactively
dataveil --configure
```

## CLI options

```
dataveil [options]

  --command PATH            MCP backend command to launch
  --arg ARG                 Backend argument; repeat as needed
  --mode redact|block       Redact fields or block sensitive tool results
  --max-message-bytes N     Maximum MCP JSON message size (default: 16 MiB)
  --backend-timeout-ms N    Backend response timeout (default: 120000)
  --gateway                 Run the DataVeil MCP gateway
  --configure               Interactive setup wizard
  --help                    Show help
```

## What gets redacted

- Oracle-style connect strings
- Credential assignments (`password=...`, `secret=...`, API tokens)
- Email addresses
- US Social Security numbers
- Phone numbers
- IPv4 addresses
- Values under known sensitive column names (`EMAIL`, `SSN`, `PHONE`, `FIRST_NAME`, `LAST_NAME`, `ADDRESS`, `PASSWORD`, `TOKEN`)
- Sensitive values in CSV-like result text when headers contain known sensitive columns

## License

MIT
