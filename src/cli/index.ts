#!/usr/bin/env node
// `fix`: load full defect context, locate and apply a code fix, sync the
// Appliqation scenario, and verify by actually running Playwright — via
// appq's own appq:fix workflow given real filesystem + shell tools plus
// (dry-run-gated) appq write access. See src/orchestrator/fix.ts for the
// actual mechanism.

import { Command } from 'commander';
import { createMcpClient, createAnthropicAdapter, createOpenAiAdapter, createUsageAccumulator } from '@appliqation/agent-core';
import type { ProviderAdapter } from '@appliqation/agent-core';
import { config, resolveProvider, resolveModel } from '../config/env.js';
import { fix } from '../orchestrator/fix.js';
import type { FixResult } from '../orchestrator/fix.js';
import { recordFixRun } from './audit.js';
import { printJsonSummary, printHumanSummary, exitCodeFor } from './output.js';
import type { FixSummary } from './output.js';

const client = createMcpClient({ origin: config.appqOrigin, apiKey: config.appqApiKey() });

function buildAdapter(): ProviderAdapter {
  const provider = resolveProvider();
  const model = resolveModel();
  return provider === 'anthropic'
    ? createAnthropicAdapter(config.anthropicApiKey!, model, config.anthropicMaxTokens)
    : createOpenAiAdapter(config.openaiApiKey!, model, config.openaiMaxOutputTokens);
}

function logEvent(prefix: string) {
  return (e: { type: string; detail?: unknown }) => {
    if (e.type === 'assistant') {
      const text = ((e.detail as string) ?? '').trim();
      if (text) console.error(`${prefix}[thinking] ${text}`);
    } else if (e.type === 'tool') {
      const d = e.detail as { name: string; result: string };
      console.error(`${prefix}[tool] ${d.name} -> ${d.result.slice(0, 300)}`);
    } else if (e.type === 'log') {
      console.error(`${prefix}[log] ${e.detail}`);
    } else if (e.type === 'usage') {
      const u = e.detail as { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number };
      const cacheNote = u.cacheReadTokens
        ? ` (${u.cacheReadTokens} from cache)`
        : u.cacheWriteTokens
          ? ` (${u.cacheWriteTokens} written to cache)`
          : '';
      console.error(`${prefix}[usage] in=${u.inputTokens} out=${u.outputTokens}${cacheNote}`);
    }
  };
}

const program = new Command();
program
  .name('appliqation-defect-fix')
  .description('Fix an Appliqation defect: load full context, locate and apply a code fix, sync the scenario, and verify it by actually running Playwright.');

program
  .command('fix')
  .description(
    "Fix one defect via appq's appq:fix workflow (context: defect text, test steps, run context, defect " +
      'history, console/network errors, recording URL), given real filesystem + an allowlisted shell so it ' +
      'can locate and edit source, plus dry-run-gated appq write access so it can sync the Appliqation ' +
      'scenario and create a real run to verify against — `npx playwright test` is what decides pass/fail, ' +
      "never the model's own claim. No git operation — a separate agent (appliqation-pr-raise) commits and " +
      'pushes whatever this one writes locally. project_id/scenario_id/test_case_uuid are never CLI options ' +
      "— appq:fix's own Phase 1 derives all of that from get_defect_context.",
  )
  .requiredOption('--defect-id <id>', 'defect ID to fix')
  .option('--repo-path <path>', 'target repo root every file/command tool call is scoped to', process.cwd())
  .option(
    '--test-instruction <text>',
    'testing scope required beyond appq:fix\'s own Phase 5 default (re-running just the reproducing test ' +
      'case) — e.g. "also re-run the whole scenario, this component has a history of regressions." Typically ' +
      'supplied by a caller (like appliqation-autopilot) that has already gathered evidence about how much ' +
      'verification this fix actually warrants.',
  )
  .option('--dry-run', 'apply and verify the fix normally, but suppress update_test_cases/add_test_cases/update_run_results — logs what would have been sent instead')
  .option('--max-turns <n>', 'override BUDGET_MAX_TURNS for this run')
  .option('--json', 'print a single structured JSON summary on stdout instead of a human-readable report')
  .option('--ci', 'shorthand for --json; exit code already reflects the real, execFile-verified outcome either way')
  .action(
    async (opts: {
      defectId: string;
      repoPath: string;
      testInstruction?: string;
      dryRun?: boolean;
      maxTurns?: string;
      json?: boolean;
      ci?: boolean;
    }) => {
      const json = (opts.json ?? false) || (opts.ci ?? false);
      const adapter = buildAdapter();
      const dryRun = opts.dryRun ?? false;

      if (dryRun) console.error('[setup] dry-run: appq test-case/run writes will be suppressed.');

      const budget = { ...config.budget, ...(opts.maxTurns ? { maxTurns: Number(opts.maxTurns) } : {}) };

      const startedAt = Date.now();
      const usage = createUsageAccumulator();
      const baseLog = logEvent('');
      let result: FixResult | undefined;
      try {
        result = await fix({
          client,
          adapter,
          defectId: opts.defectId,
          repoPath: opts.repoPath,
          budget,
          commandTimeoutMs: config.commandTimeoutMs,
          dryRun,
          testInstruction: opts.testInstruction,
          onEvent: (e) => {
            baseLog(e);
            if (e.type === 'usage') usage.onUsage(e.detail as { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number });
          },
        });
      } finally {
        // Audit write happens whether the run succeeded or threw — see
        // @appliqation/agent-core's audit/sink.ts: safeRecord() (used
        // inside recordFixRun) never lets a failed/unreachable audit sink
        // affect this process's real outcome.
        await recordFixRun({ sink: config.auditSink, startedAt, endedAt: Date.now(), model: resolveModel(), usage: usage.totals(), defectId: opts.defectId, dryRun, result });
      }

      if (!json) {
        console.log('\n=== Report ===\n');
        console.log(result.report);
        console.error(`\n(${result.turns} turns, budget exceeded: ${result.budgetExceeded})`);
      }

      const summary: FixSummary = {
        defectId: opts.defectId,
        writtenPaths: result.writtenPaths,
        testRan: result.testRun.ran,
        verified: result.testRun.ok,
        dryRun,
        report: result.report,
      };
      if (json) printJsonSummary(summary);
      else printHumanSummary(summary);
      process.exitCode = exitCodeFor(summary);
    },
  );

program.parseAsync(process.argv);
