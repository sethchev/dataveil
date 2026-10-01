---
name: dataveil
description: Set up and inspect DataVeil in Pi, or register its session gateway.
---

# DataVeil in Pi

Use `/dataveil setup` to configure a stdio database MCP backend through Pi's cancellable UI. Reload Pi after saving. `/dataveil status` reports saved configuration, not live protection. `/dataveil gateway` registers a session gateway using `~/.config/dataveil/pi/profiles.json` with block mode.

Pi owns `~/.pi/agent/mcp.json` or project `.pi/mcp.json`, using JSON `mcpServers` with `command`, `args`, and optional `env`. Its default DataVeil settings file is `~/.config/dataveil/pi/config.json`, respecting XDG/Windows settings roots. Override with `--settings` or `DATAVEIL_CONFIG_FILE`, keeping the file exclusive to Pi.

From the repository root, terminal equivalents are:

```sh
node ./dataveil-mcp-proxy/src/index.js setup --harness pi
node ./dataveil-mcp-proxy/src/index.js status --harness pi
```

Setup offers Oracle SQLcl MCP first and discovers SQLcl through environment, PATH, and common installation locations. Other databases require a supplied stdio MCP backend or a selected package through installed npx/uvx. Raw database clients are not MCP servers. Keep credentials in backend stores or inherited environment, never chat or wizard arguments.

Cancel any prompt to stop without saving. Preserve unrelated config, refuse malformed JSON, and confirm duplicate replacement. Reuse saved connections only within Pi's settings file. Gateway profiles map connection names to backend command/args; keep profiles inside Pi's DataVeil config directory.

Direct proxy defaults to redact, gateway to block. CLI `--mode` overrides `DATAVEIL_PII_MODE`; `DATAVEIL_ENABLED=false` disables gateway protection. Detection is heuristic and metadata is preserved. Never claim complete sensitive-data detection or live Pi protection from saved config or extension discovery alone.
