# Codex

DataVeil uses Codex's native TOML MCP registration. From the repository root:

```sh
node ./dataveil-mcp-proxy/src/index.js setup --harness codex
```

Choose global `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`) or project `.codex/config.toml`. Project configuration is subject to Codex project trust. Existing setting values and MCP entries are preserved; TOML comments and formatting are normalized, with the exact original file saved in a backup. DataVeil backend/policy settings default to `~/.config/dataveil/codex/config.json`.

Example (replace absolute paths):

```toml
[mcp_servers.database]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js", "--connection", "database", "--settings", "/absolute/path/to/dataveil/codex/config.json"]
```

Run `npm run test:codex` to verify preservation, cancellation, schema validation, and installed Codex reading generated TOML in isolated `CODEX_HOME`. Inspect with `codex mcp get database --json`; restart Codex and inspect `/mcp`, then make a synthetic database tool call. CLI config acceptance alone does not verify an agent tool call.
