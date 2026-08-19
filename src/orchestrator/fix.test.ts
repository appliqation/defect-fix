import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFetchAppqToolDefs, mockCreateGatedAppqDispatcher, mockRunWorkflow } = vi.hoisted(() => ({
  mockFetchAppqToolDefs: vi.fn(),
  mockCreateGatedAppqDispatcher: vi.fn(),
  mockRunWorkflow: vi.fn(),
}));
vi.mock('@appliqation/agent-core', () => ({
  fetchAppqToolDefs: mockFetchAppqToolDefs,
  createGatedAppqDispatcher: mockCreateGatedAppqDispatcher,
  runWorkflow: mockRunWorkflow,
}));

const { mockCodingDispatch, mockGetWrittenPaths, mockLastPlaywrightTestRun, MockCodingTools } = vi.hoisted(() => {
  const mockCodingDispatch = vi.fn();
  const mockGetWrittenPaths = vi.fn();
  const mockLastPlaywrightTestRun = vi.fn();
  class MockCodingTools {
    dispatch = mockCodingDispatch;
    getWrittenPaths = mockGetWrittenPaths;
    lastPlaywrightTestRun = mockLastPlaywrightTestRun;
  }
  return { mockCodingDispatch, mockGetWrittenPaths, mockLastPlaywrightTestRun, MockCodingTools };
});
vi.mock('../tools/codingTools.js', () => ({
  CodingTools: MockCodingTools,
  CODING_TOOL_DEFS: [
    { name: 'read_file', description: 'x', inputSchema: {} },
    { name: 'write_file', description: 'x', inputSchema: {} },
    { name: 'list_directory', description: 'x', inputSchema: {} },
    { name: 'run_command', description: 'x', inputSchema: {} },
  ],
}));

import { fix } from './fix.js';
import type { McpClient, ProviderAdapter, RunBudget } from '@appliqation/agent-core';

function fakeClient(): McpClient {
  return {
    fetchPrompt: vi.fn(),
    startWorkflow: vi.fn(),
    callTool: vi.fn(),
    listTools: vi.fn(),
    uploadScreenshot: vi.fn(),
  };
}

const budget: RunBudget = { maxCalls: 60, maxPages: 999_999, maxMillis: 900_000, maxTurns: 60 };

function baseOpts() {
  return {
    client: fakeClient(),
    adapter: { complete: vi.fn() } as ProviderAdapter,
    defectId: 'defect-123',
    repoPath: '/tmp/repo',
    budget,
    commandTimeoutMs: 30_000,
    dryRun: false,
  };
}

describe('fix', () => {
  beforeEach(() => {
    mockFetchAppqToolDefs.mockReset().mockResolvedValue([{ name: 'get_defect_context', description: 'x', inputSchema: {} }]);
    mockCreateGatedAppqDispatcher.mockReset().mockReturnValue(vi.fn().mockResolvedValue({ ok: true, text: 'appq result' }));
    mockRunWorkflow.mockReset().mockResolvedValue({ report: 'done', turns: 3, budgetExceeded: false });
    mockCodingDispatch.mockReset().mockResolvedValue({ ok: true, text: 'coding result' });
    mockGetWrittenPaths.mockReset().mockReturnValue(new Map());
    mockLastPlaywrightTestRun.mockReset().mockReturnValue(null);
  });

  it('calls runWorkflow against appq:fix with the defect_id', async () => {
    await fix(baseOpts());
    expect(mockRunWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: 'appq', name: 'appq:fix', args: { defect_id: 'defect-123' } },
      }),
    );
  });

  it('offers read-only, writable-appq, and coding tool defs together to the model', async () => {
    await fix(baseOpts());
    const call = mockRunWorkflow.mock.calls[0][0];
    const toolNames = call.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(['get_defect_context', 'read_file', 'write_file', 'list_directory', 'run_command']));
  });

  it('fetches appq tool defs for the union of read-only and writable allowlists', async () => {
    await fix(baseOpts());
    const allowlist = mockFetchAppqToolDefs.mock.calls[0][1] as Set<string>;
    expect(allowlist.has('get_defect_context')).toBe(true);
    expect(allowlist.has('update_test_cases')).toBe(true);
    expect(allowlist.has('add_test_cases')).toBe(true);
    expect(allowlist.has('update_run_results')).toBe(true);
  });

  it('routes coding-tool-named dispatches to CodingTools, everything else to the gated appq dispatcher', async () => {
    await fix(baseOpts());
    const dispatch = mockRunWorkflow.mock.calls[0][0].dispatch;

    await dispatch('write_file', { path: 'x', content: 'y' });
    expect(mockCodingDispatch).toHaveBeenCalledWith('write_file', { path: 'x', content: 'y' });

    const gatedFn = mockCreateGatedAppqDispatcher.mock.results[0].value;
    await dispatch('get_defect_context', { defect_id: 'defect-123' });
    expect(gatedFn).toHaveBeenCalledWith('get_defect_context', { defect_id: 'defect-123' });
  });

  it('in dry-run mode, a writable appq tool call is suppressed rather than reaching the gated dispatcher', async () => {
    const gatedInner = vi.fn().mockResolvedValue({ ok: true, text: 'would have written for real' });
    mockCreateGatedAppqDispatcher.mockReturnValue(gatedInner);
    await fix({ ...baseOpts(), dryRun: true });
    const dispatch = mockRunWorkflow.mock.calls[0][0].dispatch;

    const result = await dispatch('update_test_cases', { scenario_id: 1 });
    expect(gatedInner).not.toHaveBeenCalled();
    expect(result.text).toMatch(/suppressed/);
  });

  it('in non-dry-run mode, a writable appq tool call reaches the real gated dispatcher', async () => {
    const gatedInner = vi.fn().mockResolvedValue({ ok: true, text: 'written for real' });
    mockCreateGatedAppqDispatcher.mockReturnValue(gatedInner);
    await fix({ ...baseOpts(), dryRun: false });
    const dispatch = mockRunWorkflow.mock.calls[0][0].dispatch;

    const result = await dispatch('update_test_cases', { scenario_id: 1 });
    expect(gatedInner).toHaveBeenCalledWith('update_test_cases', { scenario_id: 1 });
    expect(result.text).toBe('written for real');
  });

  it('the seed message includes the defect ID and repo path', async () => {
    await fix(baseOpts());
    const call = mockRunWorkflow.mock.calls[0][0];
    expect(call.seedMessage).toContain('defect-123');
    expect(call.seedMessage).toContain('/tmp/repo');
  });

  it('the seed message notes dry-run mode when enabled', async () => {
    await fix({ ...baseOpts(), dryRun: true });
    const call = mockRunWorkflow.mock.calls[0][0];
    expect(call.seedMessage).toContain('Dry run');
  });

  it('the seed message includes the test instruction when given, otherwise omits it', async () => {
    await fix({ ...baseOpts(), testInstruction: 'Also re-run the whole scenario.' });
    const call = mockRunWorkflow.mock.calls[0][0];
    expect(call.seedMessage).toContain('Also re-run the whole scenario.');

    mockRunWorkflow.mockClear();
    await fix(baseOpts());
    const call2 = mockRunWorkflow.mock.calls[0][0];
    expect(call2.seedMessage).not.toContain('Required testing scope');
  });

  it('returns loopResult.report/turns/budgetExceeded unchanged', async () => {
    mockRunWorkflow.mockResolvedValue({ report: 'my report', turns: 7, budgetExceeded: true });
    const result = await fix(baseOpts());
    expect(result.report).toBe('my report');
    expect(result.turns).toBe(7);
    expect(result.budgetExceeded).toBe(true);
  });

  describe('testRun outcome — never trusts the model, only real coding-tool state', () => {
    it('ran=false, ok=false when no playwright test invocation ever happened', async () => {
      mockLastPlaywrightTestRun.mockReturnValue(null);
      const result = await fix(baseOpts());
      expect(result.testRun).toEqual({ ran: false, ok: false, exitCode: null });
    });

    it('ok=true when the last test run succeeded and happened after the last file write', async () => {
      mockGetWrittenPaths.mockReturnValue(new Map([['src/login.ts', 1000]]));
      mockLastPlaywrightTestRun.mockReturnValue({ command: 'npx', args: ['playwright', 'test'], ok: true, exitCode: 0, timestamp: 2000 });
      const result = await fix(baseOpts());
      expect(result.testRun).toEqual({ ran: true, ok: true, exitCode: 0 });
    });

    it('ok=false when a PASSING run happened BEFORE the last edit — stale, proves nothing about the file as it stands now', async () => {
      mockGetWrittenPaths.mockReturnValue(new Map([['src/login.ts', 5000]]));
      mockLastPlaywrightTestRun.mockReturnValue({ command: 'npx', args: ['playwright', 'test'], ok: true, exitCode: 0, timestamp: 2000 });
      const result = await fix(baseOpts());
      expect(result.testRun.ok).toBe(false);
      expect(result.testRun.ran).toBe(true);
    });

    it('reports every path that was written', async () => {
      mockGetWrittenPaths.mockReturnValue(
        new Map([
          ['a.ts', 1],
          ['b.ts', 2],
        ]),
      );
      const result = await fix(baseOpts());
      expect(result.writtenPaths.sort()).toEqual(['a.ts', 'b.ts']);
    });
  });
});
