// This agent's own domain knowledge of which appq tools it may touch — the
// enforcement mechanism (assertToolAllowed / the gated dispatcher) lives in
// @appliqation/agent-core, shared with every sibling agent; only the
// allowlist content is local.
//
// Unlike appliqation-scriptgen (read-only), this agent genuinely needs write
// access: appq:fix's Phase 4 requires syncing the Appliqation scenario
// (update_test_cases/add_test_cases) after a code fix, and Phase 5 requires
// creating a real run (update_run_results) to verify it. That write access
// is real appq state, not local files — see tools/dryRun.ts for how it's
// gated behind --dry-run, the same discipline appliqation-autotest's
// validator already applies to its own writes.

export const READONLY_CONTEXT_TOOLS = new Set([
  'get_defect_context',
  'get_defects',
  'get_scenario',
  'get_failure_patterns',
  'get_run_evidence',
  'get_execution_evidence',
  'get_automation_readiness',
  'get_coverage_analysis',
  'get_test_results',
]);

export const WRITABLE_APPQ_TOOLS = new Set(['update_test_cases', 'add_test_cases', 'update_run_results']);
