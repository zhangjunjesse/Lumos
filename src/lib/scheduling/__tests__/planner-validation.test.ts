const mockGetWorkflowAgentPreset = jest.fn();

jest.mock('@/lib/db/workflow-agent-presets', () => ({
  getWorkflowAgentPreset: (...args: unknown[]) => mockGetWorkflowAgentPreset(...args),
}));

import {
  validatePlannerWorkflowSemantics,
  isLongFormSynthesisAgentNode,
  promptRequestsFileWrite,
  estimateDurationSeconds,
  dependsOnPlainTextAgentNode,
} from '../planner-validation';
import type { AgentNode, WorkflowDSLV3, WorkflowNode, WorkflowEdge } from '@/lib/workflow/types-v3';

function agentNode(
  id: string,
  input: Record<string, unknown>,
  extra?: Partial<AgentNode>,
): AgentNode {
  return { id, type: 'agent', input, ...extra };
}

function dsl(nodes: WorkflowNode[], edges: WorkflowEdge[] = []): WorkflowDSLV3 {
  return { version: 'v3', name: 'test', nodes, edges };
}

beforeEach(() => {
  mockGetWorkflowAgentPreset.mockReset();
});

// ---------------------------------------------------------------------------
// validatePlannerWorkflowSemantics — researcher file-write check (role)
// ---------------------------------------------------------------------------

describe('validatePlannerWorkflowSemantics — researcher check via role', () => {
  test('no error when researcher prompt does not write files', () => {
    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode('s', { role: 'researcher', prompt: 'Summarize the codebase.' }),
    ]));
    expect(errors).toHaveLength(0);
  });

  test('error when researcher prompt requests file write', () => {
    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode('s', { role: 'researcher', prompt: 'Write the report to file /tmp/out.md' }),
    ]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('nodes.s');
    expect(errors[0]).toContain('read-only');
  });

  test('worker role is allowed to reference file writes', () => {
    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode('s', { role: 'worker', prompt: 'Write the report to file /tmp/out.md' }),
    ]));
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validatePlannerWorkflowSemantics — researcher check via preset
// ---------------------------------------------------------------------------

describe('validatePlannerWorkflowSemantics — researcher check via preset', () => {
  test('no error when preset resolves to researcher but prompt is safe', () => {
    mockGetWorkflowAgentPreset.mockReturnValue({
      id: 'builtin-researcher',
      config: { role: 'researcher', expertise: '分析' },
    });

    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode('s', { preset: 'builtin-researcher', prompt: 'Analyze evidence.' }),
    ]));
    expect(errors).toHaveLength(0);
    expect(mockGetWorkflowAgentPreset).toHaveBeenCalledWith('builtin-researcher');
  });

  test('error when preset resolves to researcher and prompt requests file write', () => {
    mockGetWorkflowAgentPreset.mockReturnValue({
      id: 'builtin-researcher',
      config: { role: 'researcher', expertise: '分析' },
    });

    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode('s', { preset: 'builtin-researcher', prompt: 'Write the report content to file /tmp/report.md' }),
    ]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('read-only');
  });

  test('no error when preset resolves to non-researcher role even with file write prompt', () => {
    mockGetWorkflowAgentPreset.mockReturnValue({
      id: 'builtin-worker',
      config: { role: 'worker', expertise: '执行' },
    });

    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode('s', { preset: 'builtin-worker', prompt: 'Write the report to file /tmp/out.md' }),
    ]));
    expect(errors).toHaveLength(0);
  });

  test('falls back gracefully when preset not found in DB', () => {
    mockGetWorkflowAgentPreset.mockReturnValue(undefined);

    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode('s', { preset: 'unknown-preset', prompt: 'Write output to /tmp/output.md' }),
    ]));
    // unknown preset → effectiveRole empty → no researcher check
    expect(errors).toHaveLength(0);
  });

  test('preset lookup error is swallowed (returns undefined)', () => {
    mockGetWorkflowAgentPreset.mockImplementation(() => {
      throw new Error('DB unavailable');
    });

    // Should not throw; resolvePresetRole catches and returns undefined
    expect(() =>
      validatePlannerWorkflowSemantics(dsl([
        agentNode('s', { preset: 'broken', prompt: 'Summarize.' }),
      ])),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validatePlannerWorkflowSemantics — timeoutMs validation
// ---------------------------------------------------------------------------

describe('validatePlannerWorkflowSemantics — timeoutMs', () => {
  test('no error when timeoutMs is omitted', () => {
    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode('s', { role: 'worker', prompt: 'Do something.' }),
    ]));
    expect(errors).toHaveLength(0);
  });

  test('error when timeoutMs is below minimum', () => {
    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode('s', { role: 'worker', prompt: 'Do something.' }, { policy: { timeoutMs: 1000 } }),
    ]));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('timeoutMs');
  });

  test('no error for long-form synthesis with sufficient timeoutMs', () => {
    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode(
        'synthesize',
        { role: 'integration', prompt: 'Write the final Markdown report.', outputMode: 'plain-text' },
        { policy: { timeoutMs: 240_000 } },
      ),
    ]));
    expect(errors).toHaveLength(0);
  });

  test('error for long-form synthesis with insufficient timeoutMs', () => {
    const errors = validatePlannerWorkflowSemantics(dsl([
      agentNode(
        'synthesize',
        { role: 'integration', prompt: 'Write the final Markdown report.', outputMode: 'plain-text' },
        { policy: { timeoutMs: 30_000 } },
      ),
    ]));
    // 30_000 is below both the base agent minimum (90_000) and the synthesis minimum (240_000)
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.includes('long-form'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isLongFormSynthesisAgentNode
// ---------------------------------------------------------------------------

describe('isLongFormSynthesisAgentNode', () => {
  function node(id: string): AgentNode {
    return { id, type: 'agent', input: {} };
  }

  test('false when outputMode is not plain-text', () => {
    expect(isLongFormSynthesisAgentNode(node('s'), { outputMode: 'structured', prompt: 'Write a report' })).toBe(false);
  });

  test('true when outputMode=plain-text and prompt contains "report"', () => {
    expect(isLongFormSynthesisAgentNode(node('s'), { outputMode: 'plain-text', prompt: 'Write the full report.' })).toBe(true);
  });

  test('true when nodeId contains "synth"', () => {
    expect(isLongFormSynthesisAgentNode(node('synthesis'), { outputMode: 'plain-text', prompt: 'Complete the task.' })).toBe(true);
  });

  test('true for Chinese prompt keywords', () => {
    expect(isLongFormSynthesisAgentNode(node('s'), { outputMode: 'plain-text', prompt: '生成研究报告' })).toBe(true);
    expect(isLongFormSynthesisAgentNode(node('s'), { outputMode: 'plain-text', prompt: '输出总结' })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// promptRequestsFileWrite
// ---------------------------------------------------------------------------

describe('promptRequestsFileWrite', () => {
  test('detects "write the report to file"', () => {
    expect(promptRequestsFileWrite('Write the report to file /tmp/out.md')).toBe(true);
  });

  test('detects "save the report to file"', () => {
    expect(promptRequestsFileWrite('Save the report to file.')).toBe(true);
  });

  test('detects "write ... /tmp/"', () => {
    expect(promptRequestsFileWrite('write it to /tmp/report.txt')).toBe(true);
  });

  test('detects Chinese file write keywords', () => {
    expect(promptRequestsFileWrite('将内容写入文件')).toBe(true);
    expect(promptRequestsFileWrite('保存到文件')).toBe(true);
  });

  test('returns false for normal prompts', () => {
    expect(promptRequestsFileWrite('Summarize the evidence and return the result.')).toBe(false);
    expect(promptRequestsFileWrite('Analyze the repository.')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// estimateDurationSeconds
// ---------------------------------------------------------------------------

describe('estimateDurationSeconds', () => {
  const baseAnalysis = {
    complexity: 'moderate' as const,
    needsBrowser: false,
    needsNotification: false,
    needsMultipleSteps: false,
    needsParallel: false,
  };

  test('returns WORKFLOW_ESTIMATED_DURATION_SECONDS when no browser', () => {
    const result = estimateDurationSeconds(dsl([agentNode('s', { role: 'worker', prompt: 'x' })]), baseAnalysis);
    expect(result).toBeGreaterThan(0);
    expect(typeof result).toBe('number');
  });

  test('returns estimate when needsBrowser is true', () => {
    const result = estimateDurationSeconds(dsl([agentNode('s', { role: 'worker', prompt: 'navigate to site' })]), { ...baseAnalysis, needsBrowser: true });
    expect(result).toBeGreaterThan(0);
  });

  test('returns estimate for parallel with multiple URLs', () => {
    const wf = dsl([agentNode('s', { role: 'worker', prompt: 'navigate to sites' })]);
    const parallel = estimateDurationSeconds(wf, {
      ...baseAnalysis,
      needsBrowser: true,
      needsParallel: true,
      detectedUrls: ['https://a.com', 'https://b.com', 'https://c.com'],
    });
    const single = estimateDurationSeconds(wf, { ...baseAnalysis, needsBrowser: true });
    expect(parallel).toBeGreaterThanOrEqual(single);
  });
});

// ---------------------------------------------------------------------------
// dependsOnPlainTextAgentNode
// ---------------------------------------------------------------------------

describe('dependsOnPlainTextAgentNode', () => {
  test('returns false when node has no predecessors', () => {
    const node: WorkflowNode = { id: 'x', type: 'capability', input: {} };
    const map = new Map<string, WorkflowNode>();
    expect(dependsOnPlainTextAgentNode(node, map, [])).toBe(false);
  });

  test('returns true when a predecessor is an agent node with plain-text outputMode', () => {
    const upstream: WorkflowNode = { id: 'up', type: 'agent', input: { outputMode: 'plain-text' } };
    const node: WorkflowNode = { id: 'x', type: 'capability', input: {} };
    const map = new Map([['up', upstream], ['x', node]]);
    const edges: WorkflowEdge[] = [{ from: 'up', to: 'x', kind: 'next' }];
    expect(dependsOnPlainTextAgentNode(node, map, edges)).toBe(true);
  });

  test('returns false when predecessor is agent but not plain-text', () => {
    const upstream: WorkflowNode = { id: 'up', type: 'agent', input: { outputMode: 'structured' } };
    const node: WorkflowNode = { id: 'x', type: 'capability', input: {} };
    const map = new Map([['up', upstream], ['x', node]]);
    const edges: WorkflowEdge[] = [{ from: 'up', to: 'x', kind: 'next' }];
    expect(dependsOnPlainTextAgentNode(node, map, edges)).toBe(false);
  });
});
