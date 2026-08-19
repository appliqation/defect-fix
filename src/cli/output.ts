// --json/--ci's renderer, matching appliqation-scriptgen's output.ts shape.
// exitCodeFor() never trusts the model's own report text — only
// FixResult.testRun.ok, which is derived from a real execFile exit code,
// decides success. A file that was never actually run — or was run before
// its last edit — is not a verified fix, no matter what the report claims.

export interface FixSummary {
  defectId: string;
  writtenPaths: string[];
  testRan: boolean;
  verified: boolean;
  dryRun: boolean;
  report: string;
}

export function printJsonSummary(summary: FixSummary): void {
  console.log(JSON.stringify(summary, null, 2));
}

export function printHumanSummary(summary: FixSummary): void {
  console.log(`\n=== Defect ${summary.defectId} ===\n`);
  if (summary.writtenPaths.length === 0) {
    console.log('  No files were written.');
  } else {
    for (const p of summary.writtenPaths) console.log(`  wrote  ${p}`);
  }
  if (!summary.testRan) {
    console.log('\n  Never actually ran `npx playwright test` — not verified.');
  } else {
    console.log(`\n  Verification: ${summary.verified ? 'PASSED' : 'FAILED (or stale — run predates the last edit)'}`);
  }
  if (summary.dryRun) {
    console.log('\n  Dry run: any Appliqation test-case/run writes were suppressed, not actually sent.');
  }
}

/** 1 unless the file was actually run — via a real, execFile-reported exit code — after its last edit, and passed. */
export function exitCodeFor(summary: FixSummary): number {
  return summary.testRan && summary.verified ? 0 : 1;
}
