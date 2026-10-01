# @dataveil/mcp-proxy

Database-agnostic stdio MCP privacy proxy. Sanitizes backend tool-call results and stderr while preserving discovery metadata.

From the repository root:

```sh
npm install
npm run build
npm test
npm pack --workspace @dataveil/mcp-proxy
npm install -g ./dataveil-mcp-proxy-0.1.0.tgz
```

Registry publication has not been verified. After local installation:

```sh
dataveil setup --harness pi
dataveil setup --harness opencode
dataveil setup --harness codex
dataveil status
dataveil --command /absolute/path/to/backend
dataveil --help
```

Only Pi, OpenCode, and Codex configuration adapters are included. Each has its own schema and default settings under `~/.config/dataveil/<harness>/config.json`. Setup backs up existing files, preserves unrelated values, refuses malformed configs, and writes nothing when cancelled. Launchers include absolute paths. The Pi extension/skill package lives separately under `harnesses/pi` in the checkout.

See [installation](https://github.com/sethchev/dataveil/blob/master/docs/install.md) and the separate [Pi](https://github.com/sethchev/dataveil/blob/master/harnesses/pi/README.md), [OpenCode](https://github.com/sethchev/dataveil/blob/master/harnesses/opencode/README.md), and [Codex](https://github.com/sethchev/dataveil/blob/master/harnesses/codex/README.md) guides.

Direct proxy defaults to redact; gateway to block. Detection is heuristic. Direct database protocols and remote HTTP MCP are unsupported. No license has been granted; metadata is UNLICENSED.
