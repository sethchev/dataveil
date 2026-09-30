# Multi-harness implementation verification

Date: 2026-09-30. This record continues `multi-harness-plan.md` and distinguishes automated evidence from actual desktop integration.

| Step | State | Evidence |
| --- | --- | --- |
| 1 | Prepared locally; not published | Package exports/binaries included in local tarball. License restored to `UNLICENSED`; publication needs separate authorization, registry ownership and authentication. |
| 2 | `[DONE:2]` | Actual shared wizard tests: arbitrary stdio backends, inherited PATH/executable checks, cancellation, SQLcl manual names, duplicates, malformed schemas, preservation, atomic saves/backups and permissions. |
| 3 | `[DONE:3]` | Every adapter tested with explicit destination override and correct root schema. Vendor references are in `install.md`. Windsurf's current docs redirect to Devin with changed paths; only an existing legacy file is offered, otherwise an explicit path is required. |
| 4 | `[DONE:4]` | Spawned help/setup/status/error/import tests; real local tarball installation; all three binaries work outside checkout and gateway alias starts gateway mode. |
| 5 | `[DONE:5]` | Actual transpiled Pi extension handler tests plus installed Pi 0.99.1 RPC extension-load smoke test. Single command dispatch, cancellation, saved status and gateway registration verified. Compiled Bun hosts resolve Node via inherited PATH rather than launching the Pi binary as Node. |
| 6 | `[DONE:6]` | Root/package README, install/per-harness docs and skill rewritten to match implemented CLI, schemas, publication status, privacy limits, and license. |
| 7 | Partial; actual second harness UI pending | Official MCP SDK 1.31.0 stdio client initializes, discovers tools and calls a synthetic backend in redact/block modes. Generated config launches the locally packed package and copied fixture outside repository cwd; sensitive text and structured values never reach the client and discovery metadata remains intact. No second desktop harness/UI test is claimed. |

Initial multi-harness validation passed: build, all 34 tests with the opt-in Pi smoke check enabled, local package installation, package dry run, and whitespace checks.

Validation commands:

```sh
npm run build
npm test
DATAVEIL_PI_SMOKE=1 npm test
node --test test/configure.test.mjs
npm pack --dry-run --workspace @dataveil/mcp-proxy
git diff --check
git status --short
```

The Pi smoke test is opt-in and uses an isolated temporary agent directory. `DATAVEIL_PI_BIN` can override the Pi executable. It loads the extension and queries command registration without querying a model or database. Normal tests skip that smoke check when Pi is unavailable.

The sandbox here denies Node child-process operations with EPERM and mounts the npm cache read-only. Spawned tests and npm pack/install were therefore run with approved execution outside the sandbox. No production database was accessed and no personal harness configuration was changed.

`code`, `cursor`, and `windsurf` executables were not found on the inherited PATH. An installed `claude` CLI does not establish that Claude Desktop is available. Remaining step 7 needs a real second harness with an accessible UI: load a generated config against the synthetic fixture, verify MCP discovery and tool invocation, inspect redaction/block behavior, and compare configured policy to the route actually used. Do not mark step 7 complete based on the SDK test or Pi load smoke test.

No npm publication or license grant was performed. Repository commit/push authorization was supplied separately after implementation validation. The pre-existing `.pi/agents/implementation.md` remains local workflow configuration and is excluded from the standalone package.


## Codex setup follow-up

Codex CLI is now a shared-wizard adapter using TOML `mcp_servers`. Setup without `--harness` always asks which harness to configure; inherited Codex session markers only suggest Codex in that chooser. Explicit harness flags take precedence. Global/project paths, inherited `CODEX_HOME`, config overrides, preservation, secure backups, cancellation, duplicate replacement, malformed TOML/schema refusal and concurrent edits are tested. TOML comments/formatting are normalized on save; the original backup preserves exact bytes.

The installed Codex CLI 0.159.2 successfully reads actual generated TOML via `codex mcp get database --json` in an isolated temporary home. This verifies config acceptance, not an actual Codex tool invocation or UI route. Personal Codex config has not been edited.

Codex follow-up validation passed: build, all 43 tests including the opt-in Pi load smoke test, packed installation with the TOML dependency, and whitespace checks.


## Shared configuration and detection follow-up

Setup now detects inherited Codex/editor context where available and prompts to confirm or choose another harness; explicit harness arguments also require confirmation. Missing detection falls back to the harness chooser. Pi supplies its own candidate through the extension.

All setup runs retain named backend connections/policy and every configured native registration in a shared user `config.json`. Native JSON/TOML entries launch `--connection NAME --settings FILE`. Tests register every supported adapter against one file, retain prior native files/entries, verify cancellation and malformed/shared concurrent changes, and verify rollback after a native save failure. Two independent official SDK clients launched from generated Codex/VS Code entries run simultaneously, survive the other client's disconnect, and pick up a changed policy after reconnecting without native config rewrites. This remains client-level evidence, not proof of those harness UIs making tool calls.

Existing direct proxy/gateway launch modes remain supported. Shared policy is loaded at startup; reconnect is required for changes. Personal harness files were not edited during these tests.

Shared-configuration validation passed: build, all 54 tests with installed Pi smoke testing enabled, local packed-package execution, and whitespace checks.
