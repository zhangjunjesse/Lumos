import {
  clearCodeHandlersForTests,
  registerCodeHandler,
} from '../code-handler-registry';
import { executeCodeHandler } from '../code-executor';
import type { AgentStepInput, WorkflowStepRuntimeContext } from '../types';

function makeInput(overrides: Partial<AgentStepInput> = {}): AgentStepInput {
  return { prompt: 'test prompt', ...overrides };
}

function makeRuntimeContext(overrides: Partial<WorkflowStepRuntimeContext> = {}): WorkflowStepRuntimeContext {
  return {
    workflowRunId: 'wf-run-1',
    stepId: 'step-1',
    stepType: 'agent',
    ...overrides,
  };
}

beforeEach(() => {
  clearCodeHandlersForTests();
});

describe('executeCodeHandler', () => {
  it('returns null when no code config', async () => {
    const result = await executeCodeHandler(makeInput(), makeRuntimeContext());
    expect(result).toBeNull();
  });

  it('returns null when strategy is agent-only', async () => {
    const input = makeInput({
      code: { handler: 'test', strategy: 'agent-only' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());
    expect(result).toBeNull();
  });

  it('code-only: returns success when handler succeeds', async () => {
    registerCodeHandler({
      id: 'test-ok',
      name: 'Test OK',
      execute: async () => ({
        success: true,
        output: { data: 'hello' },
      }),
    });

    const input = makeInput({
      code: { handler: 'test-ok', strategy: 'code-only' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).not.toBeNull();
    expect(result!.executedVia).toBe('code');
    expect(result!.result.success).toBe(true);
    expect(result!.result.output).toEqual({ data: 'hello' });
  });

  it('code-only: returns failure when handler fails (no fallback)', async () => {
    registerCodeHandler({
      id: 'test-fail',
      name: 'Test Fail',
      execute: async () => ({
        success: false,
        output: null,
        error: 'download failed',
      }),
    });

    const input = makeInput({
      code: { handler: 'test-fail', strategy: 'code-only' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).not.toBeNull();
    expect(result!.executedVia).toBe('code');
    expect(result!.result.success).toBe(false);
    expect(result!.result.error).toBe('download failed');
  });

  it('code-only: returns failure when handler throws (no fallback)', async () => {
    registerCodeHandler({
      id: 'test-throw',
      name: 'Test Throw',
      execute: async () => {
        throw new Error('unexpected crash');
      },
    });

    const input = makeInput({
      code: { handler: 'test-throw', strategy: 'code-only' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).not.toBeNull();
    expect(result!.executedVia).toBe('code');
    expect(result!.result.success).toBe(false);
    expect(result!.result.error).toBe('unexpected crash');
  });

  it('code-first: returns success when handler succeeds', async () => {
    registerCodeHandler({
      id: 'test-ok',
      name: 'Test OK',
      execute: async () => ({
        success: true,
        output: { result: 42 },
      }),
    });

    const input = makeInput({
      code: { handler: 'test-ok', strategy: 'code-first' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).not.toBeNull();
    expect(result!.executedVia).toBe('code');
    expect(result!.result.success).toBe(true);
  });

  it('code-first: returns null (fallback to agent) when handler fails', async () => {
    registerCodeHandler({
      id: 'test-fail',
      name: 'Test Fail',
      execute: async () => ({
        success: false,
        output: null,
        error: 'page not found',
      }),
    });

    const input = makeInput({
      code: { handler: 'test-fail', strategy: 'code-first' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).toBeNull();
  });

  it('code-first: returns null (fallback to agent) when handler throws', async () => {
    registerCodeHandler({
      id: 'test-throw',
      name: 'Test Throw',
      execute: async () => {
        throw new Error('network error');
      },
    });

    const input = makeInput({
      code: { handler: 'test-throw', strategy: 'code-first' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).toBeNull();
  });

  it('code-first is the default strategy', async () => {
    registerCodeHandler({
      id: 'test-fail',
      name: 'Test Fail',
      execute: async () => ({
        success: false,
        output: null,
        error: 'failed',
      }),
    });

    const input = makeInput({
      code: { handler: 'test-fail' }, // no strategy → defaults to code-first
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    // code-first + failure → null (fallback to agent)
    expect(result).toBeNull();
  });

  it('code-only: returns error when handler not found', async () => {
    const input = makeInput({
      code: { handler: 'nonexistent', strategy: 'code-only' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).not.toBeNull();
    expect(result!.result.success).toBe(false);
    expect(result!.result.error).toContain('not found');
  });

  it('code-first: returns null when handler not found (fallback)', async () => {
    const input = makeInput({
      code: { handler: 'nonexistent', strategy: 'code-first' },
    });
    const result = await executeCodeHandler(input, makeRuntimeContext());

    expect(result).toBeNull();
  });

  it('passes params and upstream outputs to handler', async () => {
    let receivedCtx: unknown = null;
    registerCodeHandler({
      id: 'ctx-check',
      name: 'Context Check',
      execute: async (ctx) => {
        receivedCtx = ctx;
        return { success: true, output: null };
      },
    });

    const input = makeInput({
      code: {
        handler: 'ctx-check',
        params: { dateRange: '2026-03' },
        strategy: 'code-only',
      },
      context: { upstream: 'some data' },
    });
    const rtx = makeRuntimeContext({ stepId: 'download' });
    await executeCodeHandler(input, rtx);

    const ctx = receivedCtx as Record<string, unknown>;
    expect(ctx.params).toEqual({ dateRange: '2026-03' });
    expect(ctx.stepId).toBe('download');
    expect(ctx.upstreamOutputs).toEqual({ upstream: 'some data' });
  });
});
