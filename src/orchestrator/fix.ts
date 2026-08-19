// Calls appq's own appq:fix workflow through the shared engine, offering it
// three tool surfaces: read-only appq context tools (get_defect_context,
// get_scenario, ...), writable appq tools (update_test_cases/add_test_cases/
// update_run_results — gated behind --dry-run, see tools/dryRun.ts), and
// real coding tools (read_file/write_file/list_directory/run_command,
// scoped to one repo). No git operation — a separate agent
// (appliqation-pr-raise) is responsible for committing/pushing what this
// one writes locally.

import {
  fetchAppqToolDefs,
  createGatedAppqDispatcher,
  runWorkflow,
  type McpClient,
  type ProviderAdapter,
  type RunBudget,
  type ToolDispatcher,
} from '@appliqation/agent-core';
import { READONLY_CONTEXT_TOOLS, WRITABLE_APPQ_TOOLS } from '../tools/safety.js';
import { CODING_TOOL_DEFS, CodingTools } from '../tools/codingTools.js';
import { createDryRunDispatcher } from '../tools/dryRun.js';

export interface FixOptions {
  client: McpClient;
  adapter: ProviderAdapter;
  defectId: string;
  /** Repo root every read_file/write_file/run_command call is scoped to. */
  repoPath: string;
  budget: RunBudget;
  commandTimeoutMs: number;
  dryRun: boolean;
  /**
   * Extra testing-scope guidance beyond appq:fix's own Phase 5 default
   * (re-run just the reproducing TC) — e.g. from appliqation-autopilot,
   * describing whether a broader scenario/suite re-test is warranted.
   */
  testInstruction?: string;
  onEvent?: (event: { type: string; detail?: unknown }) => void;
}

export interface FixResult {
  report: string;
  turns: number;
  budgetExceeded: boolean;
  /** Repo-relative paths written during this run. */
  writtenPaths: string[];
  testRun: {
    /** Whether a `npx playwright test` invocation happened at all. */
    ran: boolean;
    /**
     * Real, execFile-reported success — AND it happened after the most
     * recent file write, so an earlier pass before further edits doesn't
     * count. This is the one field that decides the CLI's exit code; it is
     * never derived from the model's own claim.
     */
    ok: boolean;
    exitCode: number | null;
  };
}

function seedMessage(opts: FixOptions): string {
  const lines = [
    `Defect ID: ${opts.defectId}`,
    `Target repo root (every file/command tool call is scoped here): ${opts.repoPath}`,
  ];
  if (opts.dryRun) {
    lines.push(
      'Dry run: update_test_cases/add_test_cases/update_run_results calls will be logged, not actually sent ' +
        'to Appliqation — proceed exactly as you normally would, the suppression happens below you.',
    );
  }
  if (opts.testInstruction) {
    lines.push(
      `Required testing scope for Phase 5, beyond just re-running the reproducing test case: ${opts.testInstruction}`,
    );
  }
  lines.push('Begin now — start with get_defect_context.');
  return lines.join('\n');
}

export async function fix(opts: FixOptions): Promise<FixResult> {
  const coding = new CodingTools(opts.repoPath, opts.commandTimeoutMs);
  const appqAllowlist = new Set([...READONLY_CONTEXT_TOOLS, ...WRITABLE_APPQ_TOOLS]);
  const appqToolDefs = await fetchAppqToolDefs(opts.client, appqAllowlist);
  const gatedAppq = createDryRunDispatcher(createGatedAppqDispatcher(opts.client, appqAllowlist), opts.dryRun);

  const codingToolNames = new Set(CODING_TOOL_DEFS.map((t) => t.name));
  const dispatch: ToolDispatcher = async (name, args) => {
    if (codingToolNames.has(name)) return coding.dispatch(name, args);
    return gatedAppq(name, args);
  };

  const loopResult = await runWorkflow({
    source: { kind: 'appq', name: 'appq:fix', args: { defect_id: opts.defectId } },
    fetchPrompt: opts.client.fetchPrompt,
    seedMessage: seedMessage(opts),
    tools: [...appqToolDefs, ...CODING_TOOL_DEFS],
    dispatch,
    adapter: opts.adapter,
    budget: opts.budget,
    onEvent: opts.onEvent,
  });

  const writtenPaths = coding.getWrittenPaths();
  const lastTestRun = coding.lastPlaywrightTestRun();
  const lastWriteAt = writtenPaths.size > 0 ? Math.max(...writtenPaths.values()) : 0;
  const verifiedAfterLastWrite = lastTestRun !== null && lastTestRun.ok && lastTestRun.timestamp >= lastWriteAt;

  return {
    report: loopResult.report,
    turns: loopResult.turns,
    budgetExceeded: loopResult.budgetExceeded,
    writtenPaths: [...writtenPaths.keys()],
    testRun: {
      ran: lastTestRun !== null,
      ok: verifiedAfterLastWrite,
      exitCode: lastTestRun?.exitCode ?? null,
    },
  };
}
