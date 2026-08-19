// --dry-run support: computes/applies the fix normally but suppresses the
// actual appq writeback (update_test_cases/add_test_cases/update_run_results
// — see tools/safety.ts's WRITABLE_APPQ_TOOLS). Implemented as a dispatch-
// level intercept, not a prompt instruction — appq:fix's own workflow prose
// is what decides to call these, so "don't write" has to be enforced below
// that, not asked of it. Same pattern as appliqation-autotest's
// tools/dryRun.ts, adapted to this agent's own write-tool set (test-case
// sync + run creation, not a verdict/defect write).

import type { ToolResult } from '@appliqation/agent-core';
import { WRITABLE_APPQ_TOOLS } from './safety.js';

export function createDryRunDispatcher(
  inner: (name: string, args: Record<string, unknown>) => Promise<ToolResult>,
  dryRun: boolean,
): (name: string, args: Record<string, unknown>) => Promise<ToolResult> {
  if (!dryRun) return inner;

  return async (name, args) => {
    if (!WRITABLE_APPQ_TOOLS.has(name)) return inner(name, args);

    console.error(`[dry-run] would call ${name} with: ${JSON.stringify(args, null, 2)}`);
    return {
      ok: true,
      text: `[dry-run] ${name} suppressed — no write happened. Args were logged for review, not sent to appq.`,
    };
  };
}
