# DataVeil

DataVeil sanitizes tool results and backend stderr between an agent and a stdio database MCP server. The supported harnesses are **Pi, OpenCode, and Codex**.

```text
Harness → DataVeil → stdio MCP backend → database
```

Install dependencies with `npm install`. Run setup from the repository root; no build step is required.

| Supported harness | Integration and setup guide | Setup from a checkout | Setup with the installed `dataveil` command |
| --- | --- | --- | --- |
| Pi | [Extension, skill, and MCP config](harnesses/pi/README.md) | `node ./dataveil-mcp-proxy/src/index.js setup --harness pi` | `dataveil setup --harness pi` |
| OpenCode | [Native MCP registration](harnesses/opencode/README.md) | `node ./dataveil-mcp-proxy/src/index.js setup --harness opencode` | `dataveil setup --harness opencode` |
| Codex | [Native TOML MCP registration](harnesses/codex/README.md) | `node ./dataveil-mcp-proxy/src/index.js setup --harness codex` | `dataveil setup --harness codex` |

To install the `dataveil` command from this checkout after `npm install`:

```sh
npm pack --workspace @dataveil/mcp-proxy
npm install -g ./dataveil-mcp-proxy-0.1.0.tgz
```

For Pi's in-harness setup, install the extension and skill with `pi install /absolute/path/to/dataveil/harnesses/pi`, then run `/dataveil setup` in Pi and `/reload`. OpenCode and Codex use the terminal setup commands above. Restart them after setup to load their MCP registration.

Setup asks for the native harness config destination, database MCP backend, privacy mode, and connection name. Oracle SQLcl MCP is supported with automatic `sql` executable discovery. PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, and custom databases require a user-selected stdio MCP backend.

Each harness has its own adapter under `dataveil-mcp-proxy/src/harnesses/`, integration assets and instructions under `harnesses/`, and default DataVeil backend/policy settings under `~/.config/dataveil/<harness>/config.json`. Personal harness registrations are ignored by Git. Backend commands, Oracle connection arguments, and privacy policy live in DataVeil’s config directory; the harness holds the launcher and a connection reference. Pi gateway profiles also live there. Changing Pi's settings does not change OpenCode or Codex settings. Existing launchers pointing to the former shared file keep working; rerun setup with each harness's default settings to move to separate files.

See [installation](docs/install.md) for the backend wizard, packaging, and policy options, and [verification](docs/verification.md) for test coverage and limits.

Test each harness separately, in order:

```sh
npm run test:pi:live
npm run test:opencode:live
npm run test:codex
```

`npm run build` and `npm test` cover the shared proxy and all adapters. Harness smoke checks use isolated temporary configs and synthetic data. A real database query in each agent remains a separate acceptance check.

Direct proxy defaults to `redact`; gateway defaults to `block`. Detection is heuristic and can miss unknown sensitive fields or produce false positives. Tool metadata is preserved. Direct database protocols and remote HTTP MCP are outside the proxy's scope. Raw database CLIs need a separate MCP backend.

No registry publication has been verified. Package metadata is `UNLICENSED`; all rights reserved.
