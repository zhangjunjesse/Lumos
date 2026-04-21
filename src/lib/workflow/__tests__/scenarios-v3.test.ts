import { compileWorkflowDslV3 } from '../compiler-v3';
import { validateCompiledWorkflowCode } from '../compiler-helpers';

/**
 * W3-B 最小测试套件:13 个 scenario 覆盖 v3 DSL 全部节点类型与 edge kind。
 * 每个 scenario 编译 → 断言 validation.valid + 生成代码能过 ts 语法检查 + manifest 正确。
 * 这套是冒烟测试,证明 "compiler-v3 能端到端处理常见组合"。
 */

function assertCompiles(spec: unknown) {
  const r = compileWorkflowDslV3(spec);
  if (!r.validation.valid) throw new Error(`compile failed: ${r.validation.errors.join(' | ')}`);
  const diag = validateCompiledWorkflowCode(r.code);
  if (diag.length > 0) throw new Error(`ts diagnostics: ${diag.join(' | ')}`);
  return r;
}

describe('v3 scenarios — minimal 13', () => {
  test('1. single agent (terminal, no edges)', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'single',
      nodes: [{ id: 'a', type: 'agent', input: { prompt: 'hello' } }],
      edges: [],
    });
    expect(r.manifest.stepIds).toEqual(['a']);
    expect(r.manifest.stepTypes).toEqual(['agent']);
    expect(r.code).toContain('stepOutputs["a"]');
  });

  test('2. agent → agent with template reference', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'chain',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'start' } },
        { id: 'b', type: 'agent', input: { prompt: '{{ steps.a.output.text }}' } },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    });
    expect(r.manifest.stepTypes).toEqual(['agent', 'agent']);
    expect(r.code).toContain('stepOutputs["b"]');
  });

  test('3. three-step sequence (a → b → c)', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'three',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'a' } },
        { id: 'b', type: 'agent', input: { prompt: '{{ steps.a.output.text }}' } },
        { id: 'c', type: 'agent', input: { prompt: '{{ steps.b.output.text }}' } },
      ],
      edges: [
        { from: 'a', to: 'b', kind: 'next' },
        { from: 'b', to: 'c', kind: 'next' },
      ],
    });
    expect(r.manifest.stepIds).toEqual(['a', 'b', 'c']);
  });

  test('4. if-else branching (then / else both terminal)', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'branch',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'pick' } },
        { id: 'gate', type: 'if-else', input: { condition: { op: 'exists', ref: 'steps.a.output.flag' } } },
        { id: 't', type: 'agent', input: { prompt: 'true path' } },
        { id: 'f', type: 'agent', input: { prompt: 'false path' } },
      ],
      edges: [
        { from: 'a', to: 'gate', kind: 'next' },
        { from: 'gate', to: 't', kind: 'then' },
        { from: 'gate', to: 'f', kind: 'else' },
      ],
    });
    expect(r.manifest.stepTypes).toContain('if-else');
  });

  test('5. for-each over collection with body', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'foreach',
      nodes: [
        { id: 'src', type: 'agent', input: { prompt: 'fetch list' } },
        {
          id: 'loop', type: 'for-each',
          input: { collection: 'steps.src.output.items', itemVar: 'item', maxIterations: 10 },
        },
        { id: 'body', type: 'agent', input: { prompt: 'process {{ item }}' } },
        { id: 'after', type: 'agent', input: { prompt: 'done' } },
      ],
      edges: [
        { from: 'src', to: 'loop', kind: 'next' },
        { from: 'loop', to: 'body', kind: 'body' },
        { from: 'loop', to: 'after', kind: 'next' },
      ],
    });
    expect(r.manifest.stepTypes).toEqual(['agent', 'for-each', 'agent', 'agent']);
  });

  test('6. while loop with state mutation', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'while',
      nodes: [
        {
          id: 'loop', type: 'while',
          input: {
            condition: { op: 'lt', left: 'state.i', right: 5 },
            maxIterations: 10,
            state: { initial: { i: 0 }, update: { i: { op: 'add', left: 'state.i', right: 1 } } },
          },
        },
        { id: 'body', type: 'agent', input: { prompt: 'iter {{ state.i }}' } },
        { id: 'after', type: 'agent', input: { prompt: 'finished' } },
      ],
      edges: [
        { from: 'loop', to: 'body', kind: 'body' },
        { from: 'loop', to: 'after', kind: 'next' },
      ],
    });
    expect(r.manifest.stepTypes).toContain('while');
  });

  test('7. wait step inside a sequence', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'wait',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'go' } },
        { id: 'w', type: 'wait', input: { durationMs: 1000 } },
        { id: 'b', type: 'agent', input: { prompt: 'resume' } },
      ],
      edges: [
        { from: 'a', to: 'w', kind: 'next' },
        { from: 'w', to: 'b', kind: 'next' },
      ],
    });
    expect(r.manifest.stepTypes).toEqual(['agent', 'wait', 'agent']);
  });

  test('8. notification terminal', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'notify',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'prep' } },
        { id: 'n', type: 'notification', input: { channel: 'email', to: 'u@x', subject: 'done' } },
      ],
      edges: [{ from: 'a', to: 'n', kind: 'next' }],
    });
    expect(r.manifest.stepTypes).toEqual(['agent', 'notification']);
  });

  test('9. capability terminal', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'cap',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'prep' } },
        { id: 'c', type: 'capability', input: { name: 'summarize', args: { text: '{{ steps.a.output.text }}' } } },
      ],
      edges: [{ from: 'a', to: 'c', kind: 'next' }],
    });
    expect(r.manifest.stepTypes).toEqual(['agent', 'capability']);
  });

  test('10. approval checkpoint + continuation', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'approval',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'draft' } },
        {
          id: 'ap', type: 'approval',
          input: {
            prompt: 'review draft',
            approvers: { mode: 'any', users: ['u1'] },
            timeout: { duration: 'PT1H', onTimeout: 'reject' },
          },
        },
        { id: 'c', type: 'agent', input: { prompt: 'publish' } },
      ],
      edges: [
        { from: 'a', to: 'ap', kind: 'next' },
        { from: 'ap', to: 'c', kind: 'next' },
      ],
    });
    expect(r.manifest.stepTypes).toEqual(['agent', 'approval', 'agent']);
    expect(r.code).toContain('approvalStep');
  });

  test('11. parallel → join (2 branches)', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'parallel',
      nodes: [
        { id: 'p', type: 'parallel', input: { onBranchFail: 'wait-all' } },
        { id: 'b1', type: 'agent', input: { prompt: 'branch1' } },
        { id: 'b2', type: 'agent', input: { prompt: 'branch2' } },
        { id: 'j', type: 'join', input: {} },
        { id: 'after', type: 'agent', input: { prompt: 'merged' } },
      ],
      edges: [
        { from: 'p', to: 'b1', kind: 'next', branchIndex: 0 },
        { from: 'p', to: 'b2', kind: 'next', branchIndex: 1 },
        { from: 'b1', to: 'j', kind: 'next' },
        { from: 'b2', to: 'j', kind: 'next' },
        { from: 'j', to: 'after', kind: 'next' },
      ],
    });
    expect(r.manifest.stepTypes).toEqual(['parallel', 'agent', 'agent', 'join', 'agent']);
  });

  test('12. on-error goto redirects to cleanup step', () => {
    // cleanup 同时接正常 next 和异常 on-error (always-run pattern),
    // 这样单入口结构下 on-error 目标也有正常入度。
    const r = assertCompiles({
      version: 'v3',
      name: 'onerror',
      nodes: [
        { id: 'start', type: 'agent', input: { prompt: 'begin' } },
        {
          id: 'risky', type: 'agent',
          input: { prompt: 'may fail' },
          onError: { action: 'goto', target: 'cleanup', retry: { max: 1, backoffMs: 100 } },
        },
        { id: 'cleanup', type: 'agent', input: { prompt: 'tidy up' } },
        { id: 'end', type: 'agent', input: { prompt: 'finish' } },
      ],
      edges: [
        { from: 'start', to: 'risky', kind: 'next' },
        { from: 'risky', to: 'cleanup', kind: 'next' },
        { from: 'risky', to: 'cleanup', kind: 'on-error' },
        { from: 'cleanup', to: 'end', kind: 'next' },
      ],
    });
    expect(r.manifest.stepTypes).toEqual(['agent', 'agent', 'agent', 'agent']);
  });

  test('13. nested: for-each body contains if-else', () => {
    const r = assertCompiles({
      version: 'v3',
      name: 'nested',
      nodes: [
        { id: 'src', type: 'agent', input: { prompt: 'list' } },
        {
          id: 'loop', type: 'for-each',
          input: { collection: 'steps.src.output.items', itemVar: 'item' },
        },
        { id: 'gate', type: 'if-else', input: { condition: { op: 'exists', ref: 'item' } } },
        { id: 'tA', type: 'agent', input: { prompt: 'true' } },
        { id: 'fA', type: 'agent', input: { prompt: 'false' } },
        { id: 'after', type: 'agent', input: { prompt: 'done' } },
      ],
      edges: [
        { from: 'src', to: 'loop', kind: 'next' },
        { from: 'loop', to: 'gate', kind: 'body' },
        { from: 'loop', to: 'after', kind: 'next' },
        { from: 'gate', to: 'tA', kind: 'then' },
        { from: 'gate', to: 'fA', kind: 'else' },
      ],
    });
    expect(r.manifest.stepTypes).toEqual(['agent', 'for-each', 'if-else', 'agent', 'agent', 'agent']);
  });
});
