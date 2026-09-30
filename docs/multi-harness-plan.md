# DataVeil multi-harness implementation handoff

## Goal

Make DataVeil an independently installable, database-agnostic privacy proxy usable by any agent harness supporting **stdio MCP**. Keep harness-specific setup adapters separate from the privacy proxy. Do not claim support for direct database protocols or remote HTTP MCP until implemented and tested.

Execute steps 2–7 below in order. After completing and verifying a step, report `[DONE:n]`. Do not mark incomplete or merely simulated work done.

## Current state (handoff)

Repository: `/home/seth/Projects/dataveil`
Remote: `https://github.com/sethchev/dataveil.git`
Branch: `master`

Recent commits:
- `af605f6`: Pi extension, skill, and README instructions.
- `c538985`: npm package preparation and initial universal wizard skeleton.

**Step 1 is prepared locally, not actually published to npm.** Previous chat incorrectly called it published. `dataveil-mcp-proxy/package.json` is no longer private and includes binary aliases (`dataveil`, `dataveil-mcp-proxy`, `dataveil-gateway`), exports, and repository metadata. Do not run `npm publish` without confirming registry name ownership, authentication, and the user's release authorization.

The package metadata and package README currently say MIT, but the user never authorized a license change and no MIT license file exists. Restore `UNLICENSED` and consistent documentation, or explicitly ask for licensing approval before release. The root README still says all rights reserved.

A subagent was tasked with steps 2–3. It returned no completion report. **There are uncommitted changes in `dataveil-mcp-proxy/src/configure.js`; inspect and test them rather than assuming they are finished.** At handoff there was no `test/configure.test.mjs`. The partial implementation includes harness definitions, validation, atomic saves/backups, and executable lookup. Recheck `git status` because state may change.

`.pi/agents/implementation.md` was created to enable a subagent using the current authenticated provider/model after the standard worker failed to resolve its model. This is local workflow configuration, not a shipping feature; don't accidentally include it in a release.

Existing commands:
```sh
npm run build
npm test
```
Existing tests cover the privacy proxy/gateway, **not the Pi extension or wizard**. Prior inline simulations copied functions and do not constitute tests of the actual extension. The last baseline run passed 9 tests.

## Architecture and important constraints

- `dataveil-mcp-proxy/src/index.js`: CLI entry point; currently does NOT dispatch `setup`, `status`, or `--configure`.
- `proxy.js`: direct stdio forwarding, argument parsing, framing, fail-closed behavior, timeout and sanitizer integration.
- `gateway.js`: named profiles and gateway MCP control tools.
- `profiles.js`: local profile loading and environment resolution.
- `redact.js`: sanitizer.
- `configure.js`: partial shared setup wizard and status implementation.
- `extensions/dataveil.ts`: currently duplicates setup/status code and must become a thin adapter.
- `skills/dataveil/SKILL.md`: currently contains misleading raw-client examples; update alongside docs.

Do not change stdout behavior of a running MCP proxy: stdout must contain MCP JSON-RPC only. Interactive CLI commands must be dispatched separately before the stdio server starts.

`psql`, `sqlite3`, `mysql`, and `mariadb` are database clients, **not MCP servers**. Detecting them does not make them eligible backend commands. A separate stdio MCP implementation is required. SQLcl's `-mcp` mode is an eligible backend. Permit any explicit stdio MCP backend, even if no known database client is installed.

Configuration evidence is not runtime evidence. Saved config must be labeled **configured**, not **active/protected/verified**. `DATAVEIL_ENABLED=false` disables gateway protection. Gateway defaults to block; direct proxy defaults to redact. Check CLI overrides before environment values. Do not imply all database access paths are protected.

## Step 2 — Universal CLI wizard (`dataveil setup`)

Inspect the partial `configure.js`, then complete a shared wizard with injectable UI/I/O so terminal and Pi use the same logic.

Requirements:
- Search the process's inherited PATH using platform-correct delimiters and executable checks; avoid shell interpolation of user input.
- Discover SQLcl (`sql`, optionally `sqlcl`) and distinguish other database clients from actual MCP backends.
- Always offer explicit/custom stdio MCP backend command and arguments.
- Collect user-defined MCP entry name separately from the backend's saved connection name.
- SQLcl saved connection names may contain punctuation/spaces: avoid treating a simplistic `connmgr list` regex as authoritative. Always permit manual entry.
- Keep passwords in backend credential stores/environment references, not chat or plain setup prompts/config arguments.
- Collect privacy mode and destination file; allow cancellation at every prompt.
- Refuse malformed JSON and invalid schemas; preserve unrelated settings and entries.
- Reject duplicate entry names unless explicit replacement is confirmed.
- Back up existing files, restrict permissions for sensitive config, and use atomic writes.
- Generate resolved `process.execPath` plus absolute local `index.js` path so configs work before npm publication and from different working directories.
- Noninteractive invocation must fail clearly or require explicit options, never silently configure the first discovered program.

Suggested API (adapt to the actual partial implementation):
```js
runConfigure(harnessKey, { scriptPath, ui, configPath, cwd })
```
`ui.input` and `ui.select` should support Pi-compatible cancellation (`undefined`). Export reusable status formatting and harness/config helpers where needed.

Acceptance: tests import actual code and exercise arbitrary backends, PATH lookup, cancellation, duplicate names, malformed JSON, preservation, backups, and generated launch arguments. Run `node --test test/configure.test.mjs`.

## Step 3 — Harness config adapters

Implement and document verified locations/schemas. Do not guess paths silently.

| Harness | Config location/schema |
|---|---|
| Claude Desktop | macOS `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows `%APPDATA%/Claude/claude_desktop_config.json`; `mcpServers` |
| Cursor | `~/.cursor/mcp.json` or project `.cursor/mcp.json`; `mcpServers` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json`; `mcpServers` |
| VS Code | project `.vscode/mcp.json`; **`servers`**, not `mcpServers`; stdio entries use supported `type` |
| Cline | user supplies the actual `cline_mcp_settings.json` path opened via Cline UI; don't confuse this with VS Code's native `.vscode/mcp.json` |
| Pi | global `~/.pi/agent/mcp.json` or project `.pi/mcp.json`; consult installed Pi docs |
| Generic | explicit file path or print config snippet with `mcpServers` |

Verify current vendor documentation where available. Unsupported platforms should prompt for an explicit path rather than invent one. Existing file detection must not imply the harness is installed or running. Handle overrides/scope consistently.

Acceptance: fixtures for every adapter schema, preserve unrelated keys, reject mismatched schemas, never write to a guessed Cline location, and test config-path override.

## Step 4 — CLI dispatch and `--configure`

Wire `index.js` to shared wizard/status logic:
```sh
dataveil setup --harness cursor
dataveil --configure --harness generic --config /path/to/mcp.json
dataveil status
```

- `setup` and `--configure` must use the same implementation.
- Validate missing values, unknown harnesses/options, and incompatible proxy/setup options.
- Use top-level async handling with useful exit codes.
- Preserve existing direct proxy and gateway behavior/arguments.
- Update help and package build/test scripts.
- Validate package exports: importing the package should not unexpectedly launch an MCP server.
- Ensure the `dataveil-gateway` alias actually behaves as documented (currently all aliases point to the same entry and do not auto-enable gateway mode).

Acceptance: spawned CLI tests for help, setup dispatch, status, error paths and normal MCP launch. `npm pack --dry-run` must show required files; install a local packed tarball in a temp directory and exercise the executable without relying on workspace paths.

## Step 5 — Thin Pi extension

Read installed Pi docs **completely** before implementation:
- `/home/seth/.local/share/mise/installs/pi/0.99.1/pi/docs/extensions.md`
- related referenced docs, including `mcp.md`, packages and UI docs as applicable.

Keep terminal prompting out of the Pi TUI. Delegate to shared wizard using a `ctx.ui` adapter, not a blocking spawned interactive process. Shared status formatter must report configuration only unless a documented runtime API can verify active routing/policy.

Verify command registration semantics: do not assume names containing spaces are valid; if needed register `dataveil` and dispatch `setup/status/gateway` from arguments. Avoid invented APIs such as an unverified `getMcpServers`. Handle ESM paths correctly instead of relying on unsupported `__dirname` assumptions. Remove unsafe non-TUI automatic config writing and accidental writes on cancelled prompts.

Acceptance: test actual extension command handlers with a mock documented API and UI; cancelled setup doesn't write. Test status output and gateway registration. Ensure extension-load smoke test passes where feasible.

## Step 6 — README and per-harness docs

Update root README, package README, `docs/install.md`, and skill instructions to reflect implemented behavior, exact supported paths/schemas, and tested commands.

Include:
- Architecture: any stdio MCP agent → DataVeil → any stdio MCP backend → database.
- SQLcl example and generic arbitrary backend example. Explicit warning raw `psql/sqlite3` are not MCP.
- Per-harness manual config examples and shared wizard invocation.
- Correct scoped package installation: `npm install -g @dataveil/mcp-proxy`; for no-install execution use `npx --yes --package @dataveil/mcp-proxy dataveil ...` **only after published**. Until then document local checkout/local tarball use.
- Status distinguishes configured policy from verified runtime connection and protection.
- Gateway control tools and direct vs gateway defaults.
- Privacy limits: heuristic redaction, unknown sensitive fields/false positives, no direct database protocol protection, backend least privilege still required.
- Do not claim actual registry publication or real harness testing without evidence.

Acceptance: all examples correspond to actual CLI options/schema, license statements consistent, no usernames/hostnames/credentials from local saved connections leak into docs.

## Step 7 — Independent client and actual harness integration

Add an independent standards-based MCP client integration test (prefer official MCP SDK with stdio transport) that launches DataVeil in front of the fake backend and verifies initialize → tools/list → tools/call. Assert sensitive fixture values never reach the client in redact/block modes and metadata is preserved. Verify actual generated config works outside repository cwd and from local packed package.

Then test with an installed second harness if available, such as Claude Desktop/Cursor/VS Code. Use synthetic data only; do not access a production database merely to prove routing. Verify MCP discovery, tool invocation, redaction and policy status.

**An SDK/client simulation is not proof of a real harness UI integration.** If no second harness is installed or UI testing is unavailable, report the independent-client integration as passed and actual harness verification as blocked/pending; do not mark all of step 7 done.

## Validation and final handoff

Run:
```sh
npm run build
npm test
node --test test/configure.test.mjs  # or include all tests in npm test
npm pack --dry-run --workspace @dataveil/mcp-proxy
git diff --check
git status --short
```

Use subagents for implementation/review if supported; keep ownership disjoint. Review the actual modified files, not copied function simulations. State which steps are verified, which are pending, and any dependencies requiring user action. No commit, push, release, npm publication, or licensing decision unless the user authorizes it.
