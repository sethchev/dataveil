---
name: dataveil
description: Configure DataVeil in front of a stdio database MCP backend, inspect saved policy, or use its named-profile gateway.
---

# DataVeil

Architecture: any stdio MCP agent → DataVeil → any stdio MCP backend → database or service.

Use DataVeil when the user wants MCP tool-result privacy. SQLcl `-mcp` is an eligible backend. Raw `psql`, `sqlite3`, `mysql`, and `mariadb` are database clients, not MCP servers; use a separate stdio MCP implementation. Any explicit stdio MCP backend is eligible regardless of installed database clients.

In Pi, `/dataveil setup` uses the shared cancellable wizard; `/dataveil status` reports saved configuration; `/dataveil gateway` registers a session-only gateway with project `dataveil-profiles.json`. Reload Pi after saved configuration changes. Non-UI setup never writes automatic defaults.

Terminal checkout equivalents:

```sh
node ./dataveil-mcp-proxy/src/index.js setup --harness pi
node ./dataveil-mcp-proxy/src/index.js status --harness pi
```

Terminal `dataveil setup` detects the caller from available session/terminal markers, asks for confirmation, and lets the user choose another harness. It includes Codex CLI and OpenCode. OpenCode is detected through inherited `OPENCODE=1` or `OPENCODE_PID`; `--harness opencode` selects it explicitly. Its global/project `opencode.json` or `opencode.jsonc` uses root `mcp`, local `type: "local"`, and a command array containing the executable and arguments. JSONC comments and unrelated entries are preserved; XDG global paths and inherited `OPENCODE_CONFIG` paths are offered. `--harness codex` explicitly selects the candidate and still prompts for confirmation, with global/project TOML `config.toml` and `CODEX_HOME` support. Codex settings and other MCP entries are preserved; TOML comments/formatting are normalized and exact original bytes are backed up.

Setup saves backend connections and all configured harness registrations in one shared DataVeil settings file (`~/.config/dataveil/config.json` by default on POSIX; XDG/Windows overrides supported). Each native MCP entry launches `--connection NAME --settings /absolute/path/to/config.json`. Register additional harnesses with setup and reuse an existing shared connection; retain prior registrations. Multiple harnesses can read the same config and run independent sessions. Shared backend/policy changes apply on reconnect, not automatically to running sessions. Use `--settings FILE` or `DATAVEIL_CONFIG_FILE` to override shared settings.

Use `--config /absolute/path/to/mcp.json` (JSON clients) or `--config /absolute/path/to/config.toml` (Codex) for overrides. For local tarball installs, use `dataveil` instead of the Node/script pair. Registry publication has not been verified; do not recommend registry execution as an available release.

Keep credentials in backend stores or inherited environment references, never chat, wizard arguments, or inline passwords. Preserve unrelated config and fail on malformed JSON. Confirm duplicate replacement. Only configuration passing through the proxy is covered; do not describe unrelated entries as protected or infer they access databases.

Pi global config is `~/.pi/agent/mcp.json`; project config is `.pi/mcp.json`, both with `mcpServers`. Use the resolved Node executable and absolute DataVeil script path; setup-generated launchers use `--connection` and `--settings`; manual direct launchers may still use `--command` with repeated `--arg` values. See `docs/install.md` for other harness paths/schemas, manual configs and packaging.

Gateway profiles:

```json
{
  "connections": {
    "demo": {
      "command": "/absolute/path/to/database-mcp-server",
      "args": []
    }
  }
}
```

`dataveil_connect` selects a profile by `name`, `dataveil_disconnect` closes it, and `dataveil_status` reports gateway routing/policy. Backend tools appear after selection; a database session may still require backend connection tools. Optional `connectTool` defaults to a `connection_name` argument equal to the profile name; match those names when using it.

Direct proxy defaults to redact, gateway to block; CLI `--mode` overrides `DATAVEIL_PII_MODE`. `DATAVEIL_ENABLED=false` disables gateway protection. CLI/Pi status is configuration evidence, not runtime evidence. Gateway status is evidence about that gateway's routing/policy, not all access paths or complete PII detection.

Redaction uses known field names and patterns, can miss unknown sensitive data, and can produce false positives. Metadata is preserved, not sanitized. Direct database protocols and remote HTTP MCP are unsupported. Least-privilege backend permissions remain necessary. Do not claim a real harness UI test based on config files or simulated clients.
