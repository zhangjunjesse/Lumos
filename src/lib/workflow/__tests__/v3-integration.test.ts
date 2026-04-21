import { compileWorkflowDslV3 } from '../compiler-v3';
import { validateCompiledWorkflowCode } from '../compiler-helpers';
import { validateWorkflowDsl } from '../validate';
import { formatIssuesForLlm } from '../validation-llm';

/**
 * W3-C 集成测试:把 W1-W3 的能力拼到一个真实业务流程里,跑端到端管线。
 * 场景:研报流水线
 *   fetch(agent, onError=continue + retry)
 *   → if-else(存在新增数据?)
 *       then → forEach(遍历标的) → summarize(agent) → approval → publish(agent)
 *       else → skip-agent
 *   → parallel(汇总 + 归档) → join → notification
 */

const realisticDsl = {
  version: 'v3',
  name: 'research-pipeline',
  description: '每日研报生成 + 审核发布',
  nodes: [
    {
      id: 'fetch',
      type: 'agent',
      input: { prompt: '抓取今日市场数据' },
      onError: { action: 'continue', retry: { max: 2, backoffMs: 500 } },
      outputContract: {
        type: 'object',
        properties: {
          targets: { type: 'array' },
          hasNew: { type: 'boolean' },
        },
      },
    },
    {
      id: 'gate',
      type: 'if-else',
      input: { condition: { op: 'exists', ref: 'steps.fetch.output.hasNew' } },
    },
    {
      id: 'loop',
      type: 'for-each',
      input: {
        collection: 'steps.fetch.output.targets',
        itemVar: 'target',
        maxIterations: 20,
      },
    },
    {
      id: 'summarize',
      type: 'agent',
      input: { prompt: '为 {{ target }} 生成研报摘要' },
    },
    {
      id: 'review',
      type: 'approval',
      input: {
        prompt: '请审核批量研报',
        approvers: { mode: 'any', users: ['editor-a'] },
        timeout: { duration: 'PT2H', onTimeout: 'reject' },
      },
    },
    {
      id: 'publish',
      type: 'agent',
      input: { prompt: '发布研报' },
    },
    {
      id: 'skip',
      type: 'agent',
      input: { prompt: '今日无新增数据,跳过' },
    },
    {
      id: 'merge',
      type: 'parallel',
      input: { onBranchFail: 'wait-all' },
    },
    {
      id: 'summary',
      type: 'agent',
      input: { prompt: '生成当日汇总' },
    },
    {
      id: 'archive',
      type: 'agent',
      input: { prompt: '归档历史' },
    },
    {
      id: 'join',
      type: 'join',
      input: {},
    },
    {
      id: 'notify',
      type: 'notification',
      input: { channel: 'email', to: 'team@x', subject: 'done' },
    },
  ],
  edges: [
    { from: 'fetch', to: 'gate', kind: 'next' },
    { from: 'gate', to: 'loop', kind: 'then' },
    { from: 'gate', to: 'skip', kind: 'else' },
    { from: 'loop', to: 'summarize', kind: 'body' },
    { from: 'loop', to: 'review', kind: 'next' },
    { from: 'review', to: 'publish', kind: 'next' },
    { from: 'publish', to: 'merge', kind: 'next' },
    { from: 'skip', to: 'merge', kind: 'next' },
    { from: 'merge', to: 'summary', kind: 'next', branchIndex: 0 },
    { from: 'merge', to: 'archive', kind: 'next', branchIndex: 1 },
    { from: 'summary', to: 'join', kind: 'next' },
    { from: 'archive', to: 'join', kind: 'next' },
    { from: 'join', to: 'notify', kind: 'next' },
  ],
};

describe('v3 end-to-end integration', () => {
  test('kitchen-sink DSL passes unified validator', () => {
    const summary = validateWorkflowDsl(realisticDsl);
    if (!summary.valid) {
      const msg = summary.issues.map((i) => `${i.code} ${i.jsonPath}: ${i.message}`).join('\n');
      throw new Error(`expected valid DSL, got issues:\n${msg}`);
    }
    expect(summary.canRun).toBe(true);
    expect(summary.errorCount).toBe(0);
  });

  test('kitchen-sink DSL compiles to valid TS module', () => {
    const r = compileWorkflowDslV3(realisticDsl);
    expect(r.validation.valid).toBe(true);
    expect(r.code).toContain('export function buildWorkflow');
    expect(r.code).toContain('approvalStep');
    expect(r.code).toContain('stepOutputs["fetch"]');
    expect(r.code).toContain('stepOutputs["publish"]');
    expect(r.manifest.stepIds.length).toBe(realisticDsl.nodes.length);
    const diag = validateCompiledWorkflowCode(r.code);
    expect(diag).toEqual([]);
  });

  test('manifest reflects all 10 node types present', () => {
    const r = compileWorkflowDslV3(realisticDsl);
    const typeSet = new Set(r.manifest.stepTypes);
    expect(typeSet).toContain('agent');
    expect(typeSet).toContain('if-else');
    expect(typeSet).toContain('for-each');
    expect(typeSet).toContain('approval');
    expect(typeSet).toContain('parallel');
    expect(typeSet).toContain('join');
    expect(typeSet).toContain('notification');
  });

  test('LLM feedback: validator issues flow through formatIssuesForLlm into prompt-ready Markdown', () => {
    const brokenDsl = {
      ...realisticDsl,
      nodes: realisticDsl.nodes.map((n) =>
        n.id === 'summarize'
          ? { ...n, input: { prompt: '{{ steps.fetch.output.missing }}' } }
          : n,
      ),
    };
    const withContract = {
      ...brokenDsl,
      nodes: brokenDsl.nodes.map((n) =>
        n.id === 'fetch'
          ? {
              ...n,
              outputContract: { type: 'object', properties: { targets: { type: 'array' } } },
            }
          : n,
      ),
    };
    const summary = validateWorkflowDsl(withContract);
    expect(summary.valid).toBe(false);
    expect(summary.errorCount).toBeGreaterThan(0);
    const md = formatIssuesForLlm(summary.issues);
    expect(md).toContain('校验错误');
    expect(md).toContain('修复要求');
  });

  test('workflowVersion is deterministic across repeated compiles', () => {
    const a = compileWorkflowDslV3(realisticDsl);
    const b = compileWorkflowDslV3(realisticDsl);
    expect(a.manifest.workflowVersion).toBe(b.manifest.workflowVersion);
    expect(a.manifest.workflowVersion).toMatch(/^dsl-v3-[a-f0-9]{12}$/);
  });
});
