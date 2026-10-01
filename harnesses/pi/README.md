# Pi

Pi owns the extension and skill in this directory. Load from the repository root:

```sh
pi --extension ./harnesses/pi/extensions/dataveil.ts
```

The repository root retains Pi package metadata pointing into this directory, so existing `pi install /absolute/path/to/dataveil` registrations continue to work.

For a new harness-specific registration, use `pi install /absolute/path/to/dataveil/harnesses/pi` to install the local Pi package. Keep the checkout available; the extension imports the proxy from it.

Run `/dataveil setup`, then `/reload`. `/dataveil status` reports saved configuration. `/dataveil gateway` registers a session-only gateway from `~/.config/dataveil/pi/profiles.json` (respects XDG and DataVeil settings overrides). It uses block mode and Pi's `codemode` exposure.

Terminal setup:

```sh
node ./dataveil-mcp-proxy/src/index.js setup --harness pi
```

Choose global `~/.pi/agent/mcp.json` or project `.pi/mcp.json`. Pi uses the JSON root `mcpServers`, with string `command`, `args`, and optional `env`. DataVeil backend/policy settings default to `~/.config/dataveil/pi/config.json`.

Manual direct proxy example (replace absolute paths):

```json
{
  "mcpServers": {
    "database": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/dataveil/dataveil-mcp-proxy/src/index.js", "--command", "/absolute/path/to/backend"]
    }
  }
}
```

Run `npm run test:pi:live` from the repository root to verify handler behavior and installed Pi extension discovery in an isolated RPC session. Then reload Pi, inspect MCP tools, and make a synthetic database tool call to verify the full agent path. Extension discovery alone does not verify result sanitization in Pi.
