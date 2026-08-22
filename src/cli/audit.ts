// Extracted out of cli/index.ts so this is testable without triggering that
// file's top-level program.parseAsync(process.argv) side effect — same
// reasoning as appliqation-autotest's cli/resolvers.ts.

import { safeRecord, safeClose, type AuditSink, type AuditRecord } from '@appliqation/agent-core';
import type { FixResult } from '../orchestrator/fix.js';
import { exitCodeFor } from './output.js';
import type { FixSummary } from './output.js';

export interface RecordFixRunArgs {
  sink: AuditSink;
  startedAt: number;
  endedAt: number;
  model: string;
  usage: AuditRecord['usage'];
  defectId: string;
  dryRun: boolean;
  /** undefined means fix() threw — the run never produced a result. */
  result: FixResult | undefined;
}

export async function recordFixRun(args: RecordFixRunArgs): Promise<void> {
  const { sink, startedAt, endedAt, model, usage, defectId, dryRun, result } = args;
  const summary: FixSummary | undefined = result
    ? { defectId, writtenPaths: result.writtenPaths, testRan: result.testRun.ran, verified: result.testRun.ok, dryRun, report: result.report }
    : undefined;

  await safeRecord(sink, {
    agent: 'appliqation-defect-fix',
    subcommand: 'fix',
    startedAt,
    endedAt,
    durationMillis: endedAt - startedAt,
    model,
    usage,
    turns: result?.turns,
    budgetExceeded: result?.budgetExceeded,
    exitCode: summary ? exitCodeFor(summary) : 1,
    outcome: summary ? { ...summary } : { defectId, dryRun, error: true },
  });
  await safeClose(sink);
}
