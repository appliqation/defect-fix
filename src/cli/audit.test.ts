import { describe, it, expect, vi } from 'vitest';
import { recordFixRun } from './audit.js';
import type { AuditSink } from '@appliqation/agent-core';

const usage = { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0 };

describe('recordFixRun', () => {
  it('records one call with agent/subcommand and the outcome shaped like FixSummary, including dryRun', async () => {
    const sink: AuditSink = { record: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    await recordFixRun({
      sink,
      startedAt: 1000,
      endedAt: 3000,
      model: 'claude-sonnet-5',
      usage,
      defectId: 'd-1',
      dryRun: true,
      result: {
        report: 'done',
        turns: 5,
        budgetExceeded: false,
        writtenPaths: ['src/x.ts'],
        testRun: { ran: true, ok: true, exitCode: 0 },
      },
    });

    expect(sink.record).toHaveBeenCalledTimes(1);
    const record = (sink.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record).toMatchObject({ agent: 'appliqation-defect-fix', subcommand: 'fix', startedAt: 1000, endedAt: 3000, durationMillis: 2000, exitCode: 0 });
    expect(record.outcome).toEqual({ defectId: 'd-1', writtenPaths: ['src/x.ts'], testRan: true, verified: true, dryRun: true, report: 'done' });
  });

  it('exitCode is 1 when the fix never verified', async () => {
    const sink: AuditSink = { record: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    await recordFixRun({
      sink,
      startedAt: 0,
      endedAt: 1,
      model: 'x',
      usage,
      defectId: 'd-1',
      dryRun: false,
      result: { report: 'r', turns: 1, budgetExceeded: false, writtenPaths: [], testRun: { ran: false, ok: false, exitCode: null } },
    });
    const record = (sink.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.exitCode).toBe(1);
  });

  it('records exitCode 1 and an error outcome when result is undefined — fix() threw', async () => {
    const sink: AuditSink = { record: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    await recordFixRun({ sink, startedAt: 0, endedAt: 1, model: 'x', usage, defectId: 'd-1', dryRun: false, result: undefined });
    const record = (sink.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.exitCode).toBe(1);
    expect(record.outcome).toEqual({ defectId: 'd-1', dryRun: false, error: true });
  });

  it('a sink failure never rejects — safeRecord swallows it', async () => {
    const sink: AuditSink = { record: vi.fn().mockRejectedValue(new Error('down')), close: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      recordFixRun({
        sink,
        startedAt: 0,
        endedAt: 1,
        model: 'x',
        usage,
        defectId: 'd-1',
        dryRun: false,
        result: { report: 'r', turns: 1, budgetExceeded: false, writtenPaths: [], testRun: { ran: true, ok: true, exitCode: 0 } },
      }),
    ).resolves.toBeUndefined();
  });

  it('closes the sink after recording — N-03: an unclosed Mongo client hangs the process since this CLI never calls process.exit()', async () => {
    const sink: AuditSink = { record: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    await recordFixRun({ sink, startedAt: 0, endedAt: 1, model: 'x', usage, defectId: 'd-1', dryRun: false, result: undefined });
    expect(sink.close).toHaveBeenCalledTimes(1);
  });

  it('still closes the sink even when record() failed', async () => {
    const sink: AuditSink = { record: vi.fn().mockRejectedValue(new Error('down')), close: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await recordFixRun({ sink, startedAt: 0, endedAt: 1, model: 'x', usage, defectId: 'd-1', dryRun: false, result: undefined });
    expect(sink.close).toHaveBeenCalledTimes(1);
  });
});
