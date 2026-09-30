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

## OpenCode setup follow-up

OpenCode is included in the setup chooser, CLI help, status scanner, and supported-harness documentation. Inherited `OPENCODE=1` or `OPENCODE_PID` suggests OpenCode and requires confirmation. Global/project JSON and JSONC paths, XDG global paths, inherited `OPENCODE_CONFIG`, and explicit overrides are supported. Native entries use `mcp`, `type: "local"`, and an executable/arguments command array referencing the same shared DataVeil connection settings as other harnesses.

Targeted JSONC edits preserve unrelated settings, existing server entries, comments, and trailing commas. Tests cover native schema validation, cancellation, declined replacement, exact backups, shared registration/reuse, disabled-entry status, and an official SDK tool call through the generated launcher that redacts fixture PII.

Installed OpenCode CLI 1.18.33 accepted the generated JSONC registration and reported the synthetic DataVeil backend as connected via `opencode mcp list` in isolated temporary HOME/XDG directories. This verifies an actual CLI connection, without claiming an OpenCode UI tool invocation or real database integration. Personal harness configurations were not edited.

Validation passed: `npm run build`, `DATAVEIL_PI_SMOKE=1 DATAVEIL_OPENCODE_SMOKE=1 npm test` (59 tests, all passed), packed installation including the JSONC parser dependency, and `git diff --check`. The OpenCode smoke check is opt-in; `DATAVEIL_OPENCODE_BIN` overrides its executable.

## Database chooser and SQLcl discovery follow-up

New connections now start with Oracle SQLcl MCP, PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, or Other database / custom MCP. Oracle searches explicit environment hints, PATH, and a bounded list of installation roots, including extracted Downloads directories. It uses a discovered executable automatically, shows its path in the saved-connection prompt, asks for a path only when discovery fails, and supplies `-mcp`. Reusing a saved connection skips database/backend selection.

Other database choices offer an installed stdio MCP executable or a user-selected package launched through installed `npx`/`uvx`. Setup records package launch arguments without executing the package. No specific third-party backend is recommended or database integration newly claimed. Raw database clients remain ineligible backend executables.

Tests verify all database branches, SQLcl discovery precedence and missing-executable fallback, saved SQLcl connections, package runner argument construction, absence of package execution during setup, invalid package names, and cancellation. Actual discovery found the system's existing Downloads SQLcl installation; its read-only version command reported release 26.3.0.0. No database connection was made.

Validation passed: build, `DATAVEIL_PI_SMOKE=1 DATAVEIL_OPENCODE_SMOKE=1 npm test` (65 tests, all passed), packed-package installation, and whitespace checks. Both READMEs, install documentation, and the DataVeil skill now describe the database-first flow.
