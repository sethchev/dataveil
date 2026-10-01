# OpenCode

DataVeil integrates through OpenCode's native MCP registration. OpenCode plugins are a separate integration mechanism; this repository does not provide a DataVeil OpenCode plugin or install Pi's extension in OpenCode.

From the repository root:

```sh
node ./dataveil-mcp-proxy/src/index.js setup --harness opencode
```

Choose global `~/.config/opencode/opencode.json` / `opencode.jsonc` (respects `XDG_CONFIG_HOME`), project `opencode.json` / `opencode.jsonc`, or an inherited `OPENCODE_CONFIG` path. JSONC comments and unrelated settings are preserved. DataVeil backend/policy settings default to `~/.config/dataveil/opencode/config.json`.

OpenCode uses root `mcp`, local `type`, and an executable-plus-arguments `command` array. Environment overrides use `environment`. Example (replace absolute paths):

```json
{
  "mcp": {
    "database": {
      "type": "local",
      "command": ["/absolute/path/to/node", "/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js", "--connection", "database", "--settings", "/absolute/path/to/dataveil/opencode/config.json"],
      "enabled": true
    }
  }
}
```

Run `npm run test:opencode:live` to check JSONC preservation, generated-launcher redaction with the MCP SDK, and installed OpenCode's `mcp list` connection in an isolated environment. Restart OpenCode and make a synthetic database tool call to check the complete agent path. A connected entry alone does not verify an OpenCode agent tool call.

Native mechanisms: [MCP servers](https://opencode.ai/docs/mcp-servers/), [plugins](https://opencode.ai/docs/plugins/).
