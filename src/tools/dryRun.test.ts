import { describe, it, expect, vi } from 'vitest';
import { createDryRunDispatcher } from './dryRun.js';
import type { ToolResult } from '@appliqation/agent-core';

describe('createDryRunDispatcher', () => {
  it('returns the inner dispatcher unchanged when dryRun is false', () => {
    const inner = vi.fn();
    const dispatch = createDryRunDispatcher(inner, false);
    expect(dispatch).toBe(inner);
  });

  it('passes through non-write appq tool calls even in dry-run mode', async () => {
    const inner = vi.fn().mockResolvedValue({ ok: true, text: 'real result' } satisfies ToolResult);
    const dispatch = createDryRunDispatcher(inner, true);
    const result = await dispatch('get_defect_context', { defect_id: '123' });
    expect(inner).toHaveBeenCalledWith('get_defect_context', { defect_id: '123' });
    expect(result.text).toBe('real result');
  });

  it('intercepts update_run_results in dry-run mode — never calls inner', async () => {
    const inner = vi.fn();
    const dispatch = createDryRunDispatcher(inner, true);
    const result = await dispatch('update_run_results', { action: 'create_run', scenario_id: 1 });
    expect(inner).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/suppressed/);
  });

  it('intercepts update_test_cases in dry-run mode — never calls inner', async () => {
    const inner = vi.fn();
    const dispatch = createDryRunDispatcher(inner, true);
    const result = await dispatch('update_test_cases', { scenario_id: 1, updates: [] });
    expect(inner).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('intercepts add_test_cases in dry-run mode — never calls inner', async () => {
    const inner = vi.fn();
    const dispatch = createDryRunDispatcher(inner, true);
    const result = await dispatch('add_test_cases', { scenario_id: 1, test_cases: [] });
    expect(inner).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('logs the suppressed args to stderr for review', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dispatch = createDryRunDispatcher(vi.fn(), true);
    await dispatch('add_test_cases', { scenario_id: 1 });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('add_test_cases'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('"scenario_id": 1'));
  });

  it('calls inner for real (non-dry-run) writes, and not the suppressed path', async () => {
    const inner = vi.fn().mockResolvedValue({ ok: true, text: 'written for real' } satisfies ToolResult);
    const dispatch = createDryRunDispatcher(inner, false);
    const result = await dispatch('update_run_results', { action: 'create_run' });
    expect(inner).toHaveBeenCalledWith('update_run_results', { action: 'create_run' });
    expect(result.text).toBe('written for real');
  });
});
