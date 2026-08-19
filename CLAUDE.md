# CLAUDE.md — appliqation-defect-fix

Part of the Appliqation workspace. See `~/Sites/localhost/CLAUDE.md` for how the
product fits together; this file is the map of **this repo only**.

## What this repo is

A standalone agent that fixes an Appliqation defect: loads full defect context, locates
and applies a code fix, syncs the Appliqation scenario, and verifies the fix by actually
running Playwright. Fourth consumer of `@appliqation/agent-core`
(`~/Sites/localhost/appliqation-agent-core/`); read that repo's `CLAUDE.md` first for
the shared engine this is built from. Architecturally closest to
`appliqation-scriptgen` — read that repo's `CLAUDE.md` too, most of the design
reasoning below is a direct extension of it.

**Deliberately thin**, same as `appliqation-scriptgen`. The context-gathering and
fixing *methodology* lives entirely in appq's own `appq:fix` MCP prompt (confirmed by
loading it directly while designing this repo — Phase 1 `get_defect_context`, Phase 2
locate code via `routes_visited`, Phase 3 examine evidence, Phase 4 apply the fix and
sync the Appliqation scenario, Phase 5 verify by actually running
`npx playwright test -- --appq-run-id={run_id} --grep "{name}"` and checking
`get_test_results`), not duplicated here. This repo's own code is only: the three tool
surfaces `fix` offers the model, the CLI, and result-shaping that never trusts the
model's own claims.

## What's new here, relative to `appliqation-scriptgen`

1. **Real appq WRITE access.** appq:fix's Phase 4/5 require `update_test_cases`,
   `add_test_cases`, and `update_run_results` — writes scriptgen never needs (it's
   read-only). This is the first agent in the family besides
   `appliqation-autotest`'s validator to carry real appq write access.
   `src/tools/safety.ts` splits `READONLY_CONTEXT_TOOLS` from `WRITABLE_APPQ_TOOLS`;
   `src/orchestrator/fix.ts` fetches tool defs for their union but wraps the dispatcher
   in `src/tools/dryRun.ts`'s `createDryRunDispatcher` (a local adaptation of
   `appliqation-autotest/src/tools/dryRun.ts`, same dispatch-intercept pattern, this
   agent's own write-tool set) — gated by `--dry-run`, same "recommended default for
   first runs against a real project" convention as `appliqation-autotest`'s `judge`.
2. **`commandGate.ts` extends scriptgen's `npx playwright test` allowlist**: accepts a
   literal `--` separator and an `--appq-run-id=<id>` flag (appq:fix's Phase 5
   invocation uses both verbatim), and allows omitting `--grep` entirely so a broader
   run (whole file/whole suite) is possible. Needed for the `--test-instruction` story
   below — still spawned via `execFile` with an explicit argv array, same discipline as
   every command-execution surface in this family.
3. **`--test-instruction <text>`** — free-text testing-scope guidance appended to the
   seed message, on top of appq:fix's own Phase 5 default (re-run just the reproducing
   TC). No new tool or verification pathway was invented for this — it reuses the
   existing `run_command`'s `npx playwright test` (now able to run broader/narrower per
   #2), keeping this agent self-contained rather than shelling out to
   `appliqation-autotest` from inside it. `appliqation-autopilot`'s `run_defect_fix`
   meta-tool is the primary intended caller of this option — see its own `CLAUDE.md`
   for how it's required to compose one from its own gathered evidence.
4. **No `--environment`/`--project-id`/`--scenario-id`/`--test-case-uuid` CLI options at
   all** — appq:fix's own Phase 1 derives everything from `get_defect_context`'s
   response, so there's nothing to resolve before the loop starts (unlike scriptgen,
   which derives `scenario_id` from a TC UUID it's given upfront). `--defect-id` is the
   only identifier this CLI accepts.

Everything else — the coding-tools surface, the never-trust-the-model's-own-claim
verification discipline (`CodingTools.lastPlaywrightTestRun()`, only counts if it
happened after the last write), no git/PR operation (reuses `appliqation-pr-raise`
unchanged) — is identical in spirit to scriptgen; see that repo's `CLAUDE.md` for the
full reasoning, not re-explained here.

## Where to find what

- `src/cli/index.ts` — `fix` command. `--defect-id` is required; `--repo-path` defaults
  to `process.cwd()`; `--test-instruction`/`--dry-run`/`--max-turns`/`--json`/`--ci` are
  optional.
- `src/orchestrator/fix.ts` — constructs the tool palette (read-only + writable appq
  tools, the writable half dry-run-wrapped, plus coding tools), routes dispatch,
  builds the seed message (defect ID, repo path, dry-run note, test instruction), calls
  `runWorkflow()` against `appq:fix`, shapes the result via `CodingTools`' tracked state.
- `src/tools/codingTools.ts` — `CodingTools`: the filesystem + shell surface, unchanged
  from scriptgen's own copy (`read_file`/`write_file`/`list_directory`/`run_command`,
  scoped to `repoPath`, tracks written paths and command history).
- `src/tools/commandGate.ts` — `assertCommandAllowed(command, args)`: the shell-command
  allowlist, extended per "What's new" #2 above. Directly unit-tested
  (`commandGate.test.ts`) — extend the allowlist here, never by loosening
  `codingTools.ts`'s call site.
- `src/tools/dryRun.ts` — `createDryRunDispatcher()`: intercepts `WRITABLE_APPQ_TOOLS`
  calls when `--dry-run` is set, logging what would have been sent instead of sending
  it.
- `src/tools/safety.ts` — `READONLY_CONTEXT_TOOLS`/`WRITABLE_APPQ_TOOLS`, this agent's
  own appq-tool allowlist content (the enforcement mechanism is
  `@appliqation/agent-core`'s `assertToolAllowed`/`createGatedAppqDispatcher`, shared
  with every sibling agent).
- `src/cli/output.ts` — `FixSummary`/`printJsonSummary`/`printHumanSummary`/
  `exitCodeFor()` — mirrors scriptgen's `output.ts`, plus a `dryRun` field.
- `src/config/env.ts` — this agent's own config. No executor/validator split, single
  `resolveModel()`. `COMMAND_TIMEOUT_MS` caps each `run_command` call; `BUDGET_MAX_*`
  caps the overall tool-calling loop.

## Explicitly out of scope for v1

- Any git/GitHub operation — see `appliqation-pr-raise`.
- A second verification pathway (e.g. shelling out to `appliqation-autotest` for a
  broader scenario/test-set check) — `--test-instruction` reuses the existing
  `run_command`/Playwright path instead; revisit only if that turns out insufficient in
  practice.
- Whole-scenario/batch mode — this agent is single-defect only.

## Commands

- `npm run dev -- fix --defect-id <id> [--repo-path <path>] [--test-instruction <text>] [--dry-run] [--max-turns <n>] [--json|--ci]`
- `npm run build` / `npm run typecheck`
- `npm test` / `npm run test:watch` — vitest, colocated `src/**/*.test.ts` files

## Config

Copy `.env.example` to `.env`. Requires `APPQ_API_KEY` (needs write access — see
"What's new" #1 above, unless every run uses `--dry-run`) and one of
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` — same credentials the other agents in this family
use.

## Keeping this file current

When you add, remove, or rename a top-level file or a directory under `src/`, update
the map above in the same change.
