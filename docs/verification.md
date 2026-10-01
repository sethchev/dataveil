# Harness verification

Date: 2026-09-30.

Pi, OpenCode, and Codex now have separate configuration adapters, integration guides, default backend/policy files, and test commands. Pi owns its extension/skill package under `harnesses/pi`. OpenCode uses native MCP registration; no DataVeil OpenCode plugin is implemented. Codex uses native TOML registration. Other harness adapters and the root generic `.mcp.json` example were removed.

Installed harness checks were run separately in this order:

| Harness | Command | Evidence |
| --- | --- | --- |
| Pi | `npm run test:pi:live` | Actual extension handlers pass; installed Pi loads the relocated extension and lists `/dataveil` through an isolated RPC session. |
| OpenCode | `npm run test:opencode:live` | JSONC preservation and generated-launcher redaction pass; installed OpenCode reports the synthetic MCP backend connected. |
| Codex | `npm run test:codex` | All nine tests pass; installed Codex reads generated TOML through `mcp get` in isolated `CODEX_HOME`. |

The final full suite with `DATAVEIL_PI_SMOKE=1 DATAVEIL_OPENCODE_SMOKE=1 npm test` passed **58 tests, zero failures, zero skips**. `npm run build` and `git diff --check` passed. The suite also packs/installs the proxy outside the checkout and exercises tool discovery and synthetic calls through the official MCP SDK in redact and block modes.

Isolation tests configure all three harnesses with distinct default settings files, change only Pi to block mode, and call each generated launcher. Pi blocks fixture PII while OpenCode and Codex continue to redact it. Aggregate status reads all three independent settings files. Setup refuses an explicit settings file registered to another harness. Tests also cover cancellation, backups, malformed schemas, policy overrides, concurrent edits, save rollback, and rejection of removed harness names.

All installed-harness checks use temporary configs and synthetic backends. Existing user configs, local untracked registrations, and the former shared settings file were not migrated. Existing launchers continue to work against their explicit legacy path; rerun each harness's setup to adopt separate defaults.

No real database query through the Pi, OpenCode, or Codex agent UI is claimed. Complete those acceptance checks one harness at a time with synthetic data before treating an agent's database path as verified. No npm registry publication has been verified.

Child-process tests require execution outside this environment's restricted sandbox; the final suite used approved execution.

Pi startup regression fix: restored root `package.json` Pi metadata pointing to the separated extension/skill. The previous smoke test loaded the extension file directly and missed installed-checkout package discovery. Added a registered-checkout startup test; `npm run test:pi:live` now passes all 14 Pi checks, including both loading paths. Existing root package registrations need no reinstall.

Personal configuration storage: Git ignores local OpenCode/Pi/Codex registrations, DataVeil connection files under a local `.config/dataveil/`, and setup backups. Pi gateway profiles now default beside its DataVeil settings rather than inside the project. Standalone gateway profile resolution respects the same XDG/Windows roots and overrides. The full installed-harness suite passed 60 tests, zero failures or skips, after these changes. Existing personal files were preserved.
