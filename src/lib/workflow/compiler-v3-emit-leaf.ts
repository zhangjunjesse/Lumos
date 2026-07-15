import {
  createStepRunConfig,
  emitLiteral,
  emitTimeoutLiteral,
  resolveCompiledStepTimeoutMs,
  resolvedInputBindingName,
  resultBindingName,
  runtimeContextBindingName,
} from './compiler-helpers';
import { getStepCompilerDefinition } from './step-registry';
import type { ApprovalNode, WorkflowNode } from './types-v3';
import type { WorkflowStep } from './types';

// ── Leaf emitter ────────────────────────────────────────────────────────────
//
// v3 Leaf = agent / team / notification / capability / wait / approval / join。
// agent/notification/capability/wait 走 runtime step-registry (复用 v2 绑定)。
// approval 走 runtime.approvalStep (W2-C 实装挂起语义; 本层只发射调用)。
// join 由 parallel emitter 汇聚分支, 此处不应单独命中 —— 命中则异常。
//
// onError.action 处理:
//   'fail'     → 默认抛出 (runtime __executeStep 会重试后抛)
//   'continue' → try/catch 吞掉错误, stepOutputs[id] 写 null, 继续后续步骤
//   'goto'     → 本层发射捕获 + 设置 __goto 标记; 外层 sequence 检测并 break
//                (完整 goto 语义由外层 emitter 承接, 此处只标记)

export interface LeafEmitContext {
  outerStateExpr: string;
}

export function emitLeaf(node: WorkflowNode, ctx: LeafEmitContext, indent: number): string {
  switch (node.type) {
    case 'agent':
    case 'team':
    case 'notification':
    case 'capability':
    case 'wait':
      return emitRegistryStep(node, ctx.outerStateExpr, indent);
    case 'approval':
      return emitApproval(node, ctx.outerStateExpr, indent);
    case 'join':
      // join 由 parallel 发射, 不应到这里
      throw new Error(`emitLeaf: join "${node.id}" should be emitted by parallel block`);
    default:
      throw new Error(`emitLeaf: unsupported leaf type "${(node as { type: string }).type}"`);
  }
}

// ── Registry-backed steps (agent / notification / capability / wait) ────────

function emitRegistryStep(node: WorkflowNode, stateExpr: string, indent: number): string {
  const pad = ' '.repeat(indent);
  const def = getStepCompilerDefinition(node.type);
  if (!def) throw new Error(`emitRegistryStep: unknown type "${node.type}"`);

  const step = toStepShape(node);
  const sid = emitLiteral(node.id);
  const stype = emitLiteral(node.type);
  const inputLit = emitLiteral((node as { input?: unknown }).input ?? {});
  const configLit = emitLiteral(createStepRunConfig(step));
  const timeoutLit = emitTimeoutLiteral(resolveCompiledStepTimeoutMs(step));
  const bind = resultBindingName(node.id);
  const rInput = resolvedInputBindingName(node.id);
  const rtx = runtimeContextBindingName(node.id);

  const execFn = node.policy?.continueOnFailure ? '__executeStepSafe' : '__executeStep';
  const core = [
    `${pad}const ${rtx} = __resolveRuntimeContext(input, { workflowRunId: run.id, stepId: ${sid}, stepType: ${stype}, timeoutMs: ${timeoutLit} });`,
    `${pad}const ${rInput} = __attachRuntimeContext(__resolveValue(${inputLit}, input, stepOutputs, ${stateExpr}), ${rtx});`,
    `${pad}const ${bind} = await step.run(${configLit}, () => ${execFn}({`,
    `${pad}  workflowRunId: run.id, stepId: ${sid},`,
    `${pad}  runStep: () => __withTimeout(${def.runtimeBinding}(${rInput}), ${timeoutLit}, ${sid}),`,
    `${pad}  onStepStarted, onStepCompleted, retryPolicy: ${configLit}.retryPolicy`,
    `${pad}}));`,
    `${pad}stepOutputs[${sid}] = ${bind};`,
    `${pad}await onStepOutput?.({ workflowRunId: run.id, stepId: ${sid}, stepType: ${stype}, output: ${bind}.output });`,
  ];
  return wrapForGotoReplay(node, wrapOnError(node, core.join('\n'), indent), indent);
}

function toStepShape(node: WorkflowNode): WorkflowStep {
  const step: WorkflowStep = {
    id: node.id,
    type: node.type as WorkflowStep['type'],
    input: (node as { input?: Record<string, unknown> }).input,
    policy: node.policy,
    metadata: node.metadata,
  };
  return step;
}

// ── Approval ────────────────────────────────────────────────────────────────
//
// 运行时行为 (W2-C 实装):
//   1. runtime.approvalStep(input) 创建 approval_requests 记录, 返回 { suspended: true, requestId }
//   2. engine 捕获 suspended 信号, checkpoint 整个 workflow 状态到 DB
//   3. 人工批准后, engine 恢复执行, approvalStep 返回 { success: true, output: { status, by, form } }
// 本层只负责发射调用; runtime 没实装时 approvalStep 为 noop, 返回 auto-approved。

function emitApproval(node: WorkflowNode, stateExpr: string, indent: number): string {
  const pad = ' '.repeat(indent);
  const approval = node as ApprovalNode;
  const sid = emitLiteral(node.id);
  const stype = emitLiteral('approval');
  const inputLit = emitLiteral(approval.input);
  const configLit = emitLiteral({ name: node.id, retryPolicy: { maximumAttempts: 1 } });
  const timeoutLit = 'undefined';
  const bind = resultBindingName(node.id);
  const rInput = resolvedInputBindingName(node.id);
  const rtx = runtimeContextBindingName(node.id);

  const core = [
    `${pad}const ${rtx} = __resolveRuntimeContext(input, { workflowRunId: run.id, stepId: ${sid}, stepType: ${stype}, timeoutMs: ${timeoutLit} });`,
    `${pad}const ${rInput} = __attachRuntimeContext(__resolveValue(${inputLit}, input, stepOutputs, ${stateExpr}), ${rtx});`,
    `${pad}const ${bind} = await step.run(${configLit}, () => __executeStep({`,
    `${pad}  workflowRunId: run.id, stepId: ${sid},`,
    `${pad}  runStep: () => approvalStep(${rInput}),`,
    `${pad}  onStepStarted, onStepCompleted, retryPolicy: ${configLit}.retryPolicy`,
    `${pad}}));`,
    `${pad}stepOutputs[${sid}] = ${bind};`,
    `${pad}await onStepOutput?.({ workflowRunId: run.id, stepId: ${sid}, stepType: ${stype}, output: ${bind}.output });`,
  ];
  return wrapForGotoReplay(node, wrapOnError(node, core.join('\n'), indent), indent);
}

// ── onError wrapper ────────────────────────────────────────────────────────

function wrapOnError(node: WorkflowNode, core: string, indent: number): string {
  const oe = node.onError;
  if (!oe || oe.action === 'fail') return core;
  const pad = ' '.repeat(indent);
  const sid = emitLiteral(node.id);
  if (oe.action === 'continue') {
    return [
      `${pad}try {`,
      core,
      `${pad}} catch (__err) {`,
      `${pad}  console.warn(\`[workflow] step ${node.id} failed (continue): \${__err instanceof Error ? __err.message : String(__err)}\`);`,
      `${pad}  stepOutputs[${sid}] = { success: false, output: null, error: __err instanceof Error ? __err.message : String(__err) };`,
      `${pad}}`,
    ].join('\n');
  }
  // goto: 标记 __goto, 外层 sequence 检测后跳出重进指定节点
  // 注: 完整 goto 调度由 W2-B-3 module wrapper 的 goto loop 实现
  const targetLit = emitLiteral(oe.target);
  return [
    `${pad}try {`,
    core,
    `${pad}} catch (__err) {`,
    `${pad}  stepOutputs[${sid}] = { success: false, output: null, error: __err instanceof Error ? __err.message : String(__err) };`,
    `${pad}  __goto = ${targetLit};`,
    `${pad}  throw new __GotoSignal(${targetLit});`,
    `${pad}}`,
  ].join('\n');
}

function wrapForGotoReplay(node: WorkflowNode, body: string, indent: number): string {
  const pad = ' '.repeat(indent);
  const sid = emitLiteral(node.id);
  const stype = emitLiteral(node.type);
  return [
    `${pad}if (__shouldSkipStep(${sid})) {`,
    `${pad}  await onStepSkipped?.({ workflowRunId: run.id, stepId: ${sid}, stepType: ${stype} });`,
    `${pad}} else {`,
    indentCode(body, 2),
    `${pad}}`,
  ].join('\n');
}

function indentCode(code: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return code
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}
