import { extractBlocks } from '../compiler-v3-blocks';
import { emitBlock } from '../compiler-v3-emitters';
import type { WorkflowDSLV3, WorkflowEdge, WorkflowNode } from '../types-v3';

const agent = (id: string, input: Record<string, unknown> = { prompt: 'hi' }): WorkflowNode =>
  ({ id, type: 'agent', input }) as WorkflowNode;
const parallel = (id: string): WorkflowNode => ({ id, type: 'parallel', input: {} }) as WorkflowNode;
const join = (id: string): WorkflowNode => ({ id, type: 'join', input: {} }) as WorkflowNode;
const ifElse = (id: string): WorkflowNode => ({
  id, type: 'if-else', input: { condition: { op: 'exists', ref: 'input.x' } },
}) as WorkflowNode;
const forEach = (id: string): WorkflowNode => ({
  id, type: 'for-each', input: { collection: 'steps.a.output.list', itemVar: 'item' },
}) as WorkflowNode;
const approval = (id: string): WorkflowNode => ({
  id, type: 'approval',
  input: { prompt: 'please', approvers: { mode: 'any', users: ['u1'] } },
}) as WorkflowNode;
const edge = (from: string, to: string, kind: WorkflowEdge['kind'], branchIndex?: number): WorkflowEdge =>
  branchIndex === undefined ? { from, to, kind } : { from, to, kind, branchIndex };

const nodesById = (nodes: WorkflowNode[]): Map<string, WorkflowNode> =>
  new Map(nodes.map((n) => [n.id, n]));

const mk = (nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDSLV3 => ({
  version: 'v3', name: 't', nodes, edges,
});

const compile = (dsl: WorkflowDSLV3): string => {
  const block = extractBlocks(dsl);
  return emitBlock(block, { nodeById: nodesById(dsl.nodes), outerStateExpr: 'undefined' }, 6);
};

describe('emitBlock', () => {
  test('single agent leaf emits agentStep call', () => {
    const code = compile(mk([agent('a')], []));
    expect(code).toContain('agentStep(');
    expect(code).toContain('stepOutputs["a"]');
    expect(code).toContain('await onStepOutput?.({ workflowRunId: run.id, stepId: "a", stepType: "agent", output: __result_a.output });');
  });

  test('linear sequence emits two successive agent steps', () => {
    const code = compile(mk(
      [agent('a'), agent('b')],
      [edge('a', 'b', 'next')],
    ));
    expect(code).toContain('stepOutputs["a"]');
    expect(code).toContain('stepOutputs["b"]');
  });

  test('if-else block emits condition + then/else branches', () => {
    const dsl = mk(
      [ifElse('g'), agent('t'), agent('e'), agent('m')],
      [
        edge('g', 't', 'then'),
        edge('g', 'e', 'else'),
        edge('t', 'm', 'next'),
        edge('e', 'm', 'next'),
      ],
    );
    const code = compile(dsl);
    expect(code).toContain('__evaluateCondition');
    expect(code).toContain('if (__branch_g)');
    expect(code).toContain('} else {');
    expect(code).toContain('stepOutputs["g"] = { success: true, output: { branch:');
  });

  test('for-each loop emits for loop + body emission', () => {
    const dsl = mk(
      [agent('a'), forEach('loop'), agent('body'), agent('after')],
      [
        edge('a', 'loop', 'next'),
        edge('loop', 'body', 'body'),
        edge('body', 'loop', 'next'),
        edge('loop', 'after', 'next'),
      ],
    );
    const code = compile(dsl);
    expect(code).toContain('__items_loop');
    expect(code).toContain('for (let __i_loop');
    expect(code).toContain('stepOutputs["body"]');
    expect(code).toContain('stepOutputs["after"]');
  });

  test('parallel + join emits Promise.all and aggregates branches into join', () => {
    const dsl = mk(
      [parallel('p'), agent('b1'), agent('b2'), join('j'), agent('end')],
      [
        edge('p', 'b1', 'next', 0),
        edge('p', 'b2', 'next', 1),
        edge('b1', 'j', 'next'),
        edge('b2', 'j', 'next'),
        edge('j', 'end', 'next'),
      ],
    );
    const code = compile(dsl);
    expect(code).toContain('Promise.all([');
    expect(code).toContain('(async () => {');
    expect(code).toContain('stepOutputs["p"]');
    expect(code).toContain('stepOutputs["j"] = { success: true, output: { branches: [__branch_p_0, __branch_p_1]');
  });

  test('approval node emits approvalStep runtime call', () => {
    const code = compile(mk(
      [agent('a'), approval('ap')],
      [edge('a', 'ap', 'next')],
    ));
    expect(code).toContain('approvalStep(');
    expect(code).toContain('stepOutputs["ap"]');
  });

  test('onError action=continue wraps leaf in try/catch', () => {
    const node = agent('a');
    node.onError = { action: 'continue' };
    const code = compile(mk([node, agent('b')], [edge('a', 'b', 'next')]));
    expect(code).toContain('try {');
    expect(code).toContain('} catch (__err) {');
    expect(code).toContain('(continue)');
  });

  test('produces syntactically valid JS (node can parse)', () => {
    const dsl = mk(
      [parallel('p'), agent('b1'), agent('b2'), join('j'), agent('end')],
      [
        edge('p', 'b1', 'next', 0),
        edge('p', 'b2', 'next', 1),
        edge('b1', 'j', 'next'),
        edge('b2', 'j', 'next'),
        edge('j', 'end', 'next'),
      ],
    );
    const code = compile(dsl);
    // Wrap in async function so top-level await is legal
    const wrapper = `(async function(){ const input={}; const stepOutputs={}; const run={id:'r'}; const step={run:async(_c,fn)=>fn()}; const agentStep=async()=>({success:true,output:null}); const notificationStep=agentStep, capabilityStep=agentStep, waitStep=agentStep, approvalStep=agentStep; const onStepStarted=async()=>{}, onStepCompleted=async()=>{}, onStepOutput=async()=>{}, onStepSkipped=async()=>{}; function __resolveRuntimeContext(){return{}}; function __attachRuntimeContext(v){return v}; function __resolveValue(v){return v}; function __resolveRef(){return[]}; function __evaluateCondition(){return true}; async function __withTimeout(p){return p}; async function __executeStep(o){return o.runStep()}; async function __executeStepSafe(o){return o.runStep()}; \n${code}\n })`;
    expect(() => new Function(wrapper)).not.toThrow();
  });
});
