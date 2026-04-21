import {
  emitLiteral,
  resultBindingName,
  toSafeIdentifier,
} from './compiler-helpers';
import type { Block } from './compiler-v3-blocks';
import type { ForEachNode, WhileNode, WorkflowNode } from './types-v3';
import { FOR_EACH_MAX_ITERATIONS_DEFAULT, WHILE_MAX_ITERATIONS_DEFAULT } from './types-v3';

// ── Control-flow emitters ───────────────────────────────────────────────────
//
// 依赖 emitBlock 递归 emit 子块 —— 注入式, 避免循环依赖。

export interface ControlEmitContext {
  emitBlock: (block: Block, stateExpr: string, indent: number) => string;
  outerStateExpr: string;
}

// ── If-else ─────────────────────────────────────────────────────────────────

export function emitIfElse(
  head: WorkflowNode,
  thenBlock: Block,
  elseBlock: Block,
  ctx: ControlEmitContext,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const input = (head as { input: { condition: unknown } }).input;
  const condLit = emitLiteral(input.condition);
  const sid = emitLiteral(head.id);
  const safe = toSafeIdentifier(head.id);
  return [
    `${pad}// if-else: ${head.id}`,
    `${pad}await onStepStarted?.({ workflowRunId: run.id, stepId: ${sid} });`,
    `${pad}const __branch_${safe} = __evaluateCondition(${condLit}, input, stepOutputs, ${ctx.outerStateExpr});`,
    `${pad}if (__branch_${safe}) {`,
    ctx.emitBlock(thenBlock, ctx.outerStateExpr, indent + 2),
    `${pad}} else {`,
    ctx.emitBlock(elseBlock, ctx.outerStateExpr, indent + 2),
    `${pad}}`,
    `${pad}stepOutputs[${sid}] = { success: true, output: { branch: __branch_${safe} ? "then" : "else" } };`,
    `${pad}await onStepOutput?.({ workflowRunId: run.id, stepId: ${sid}, stepType: "if-else", output: stepOutputs[${sid}].output });`,
    `${pad}await onStepCompleted?.({ workflowRunId: run.id, stepId: ${sid} });`,
  ].join('\n');
}

// ── For-each / While ────────────────────────────────────────────────────────

export function emitLoop(
  head: WorkflowNode,
  body: Block,
  ctx: ControlEmitContext,
  indent: number,
): string {
  if (head.type === 'for-each') return emitForEach(head, body, ctx, indent);
  if (head.type === 'while') return emitWhile(head, body, ctx, indent);
  throw new Error(`emitLoop: unsupported loop type "${head.type}"`);
}

function emitForEach(head: ForEachNode, body: Block, ctx: ControlEmitContext, indent: number): string {
  const pad = ' '.repeat(indent);
  const input = head.input;
  const collectionRef = input.collection;
  const itemVar = input.itemVar || 'item';
  const maxIter = typeof input.maxIterations === 'number' ? input.maxIterations : FOR_EACH_MAX_ITERATIONS_DEFAULT;
  const sid = emitLiteral(head.id);
  const safe = toSafeIdentifier(head.id);
  return [
    `${pad}// for-each: ${head.id}`,
    `${pad}await onStepStarted?.({ workflowRunId: run.id, stepId: ${sid} });`,
    `${pad}const __col_${safe} = __resolveRef(${emitLiteral(collectionRef)}, input, stepOutputs, ${ctx.outerStateExpr});`,
    `${pad}const __items_${safe} = Array.isArray(__col_${safe}) ? __col_${safe} : [];`,
    `${pad}const __results_${safe} = [];`,
    `${pad}for (let __i_${safe} = 0; __i_${safe} < Math.min(__items_${safe}.length, ${maxIter}); __i_${safe}++) {`,
    `${pad}  stepOutputs[${sid}] = { success: true, output: { ${itemVar}: __items_${safe}[__i_${safe}], currentItem: __items_${safe}[__i_${safe}], index: __i_${safe} } };`,
    ctx.emitBlock(body, ctx.outerStateExpr, indent + 2),
    `${pad}  __results_${safe}.push(stepOutputs[${sid}]);`,
    `${pad}}`,
    `${pad}stepOutputs[${sid}] = { success: true, output: { results: __results_${safe}, count: __results_${safe}.length } };`,
    `${pad}await onStepOutput?.({ workflowRunId: run.id, stepId: ${sid}, stepType: "for-each", output: stepOutputs[${sid}].output });`,
    `${pad}await onStepCompleted?.({ workflowRunId: run.id, stepId: ${sid} });`,
  ].join('\n');
}

function emitWhile(head: WhileNode, body: Block, ctx: ControlEmitContext, indent: number): string {
  const pad = ' '.repeat(indent);
  const input = head.input;
  const condLit = emitLiteral(input.condition);
  const maxIter = typeof input.maxIterations === 'number' ? input.maxIterations : WHILE_MAX_ITERATIONS_DEFAULT;
  const sid = emitLiteral(head.id);
  const safe = toSafeIdentifier(head.id);
  const isDoWhile = input.mode === 'do-while';
  const stateVar = `__state_${safe}`;

  const state = input.state;
  const hasInitial = !!state && 'initial' in state;
  const hasUpdate = !!state && 'update' in state && state.update !== undefined;
  const initialLit = hasInitial ? emitLiteral(state!.initial) : 'undefined';
  const updateLit = hasUpdate ? emitLiteral(state!.update) : null;

  const iterErrorVar = `__iterErr_${safe}`;
  const stateInitLine = hasInitial
    ? `${pad}let ${stateVar} = __resolveValue(${initialLit}, input, stepOutputs, ${ctx.outerStateExpr});`
    : `${pad}let ${stateVar} = undefined;`;
  const updateLine = updateLit
    ? `${pad}    ${stateVar} = __mergeState(${stateVar}, __resolveValue(${updateLit}, input, stepOutputs, ${stateVar}));`
    : '';

  const bodyCode = ctx.emitBlock(body, stateVar, indent + 2);
  const tail = [
    `${pad}stepOutputs[${sid}] = { success: true, output: { state: ${stateVar}, iterations: __iter_${safe}, errors: ${iterErrorVar} } };`,
    `${pad}await onStepOutput?.({ workflowRunId: run.id, stepId: ${sid}, stepType: "while", output: stepOutputs[${sid}].output });`,
    `${pad}await onStepCompleted?.({ workflowRunId: run.id, stepId: ${sid} });`,
  ];

  const loopHeader = isDoWhile
    ? [
        `${pad}do {`,
        `${pad}  try {`,
        bodyCode,
        updateLine,
        `${pad}  } catch (__e) {`,
        `${pad}    const __msg = __e instanceof Error ? __e.message : String(__e);`,
        `${pad}    ${iterErrorVar}.push({ iteration: __iter_${safe}, error: __msg });`,
        `${pad}  }`,
        `${pad}  __iter_${safe}++;`,
        `${pad}} while (__evaluateCondition(${condLit}, input, stepOutputs, ${stateVar}) && __iter_${safe} < ${maxIter});`,
      ]
    : [
        `${pad}while (__evaluateCondition(${condLit}, input, stepOutputs, ${stateVar}) && __iter_${safe} < ${maxIter}) {`,
        `${pad}  try {`,
        bodyCode,
        updateLine,
        `${pad}  } catch (__e) {`,
        `${pad}    const __msg = __e instanceof Error ? __e.message : String(__e);`,
        `${pad}    ${iterErrorVar}.push({ iteration: __iter_${safe}, error: __msg });`,
        `${pad}  }`,
        `${pad}  __iter_${safe}++;`,
        `${pad}}`,
      ];

  return [
    `${pad}// ${isDoWhile ? 'do-while' : 'while'}: ${head.id}`,
    `${pad}await onStepStarted?.({ workflowRunId: run.id, stepId: ${sid} });`,
    stateInitLine,
    `${pad}let __iter_${safe} = 0;`,
    `${pad}let ${iterErrorVar} = [];`,
    ...loopHeader,
    ...tail,
  ].filter(Boolean).join('\n');
}

// ── Parallel ───────────────────────────────────────────────────────────────

export function emitParallel(
  head: WorkflowNode,
  joinId: string,
  branches: Block[],
  ctx: ControlEmitContext,
  indent: number,
): string {
  const pad = ' '.repeat(indent);
  const sid = emitLiteral(head.id);
  const jid = emitLiteral(joinId);
  const safe = toSafeIdentifier(head.id);

  const branchBindings = branches.map((_, i) => `__branch_${safe}_${i}`);
  const branchPromises = branches.map((block) => {
    const inner = ctx.emitBlock(block, ctx.outerStateExpr, indent + 4);
    const lastId = lastIdOf(block);
    return [
      `${pad}    (async () => {`,
      inner,
      `${pad}      return ${lastId ? `stepOutputs[${emitLiteral(lastId)}]` : 'null'};`,
      `${pad}    })()`,
    ].join('\n');
  }).join(',\n');

  return [
    `${pad}// parallel: ${head.id}`,
    `${pad}await onStepStarted?.({ workflowRunId: run.id, stepId: ${sid} });`,
    `${pad}const [${branchBindings.join(', ')}] = await Promise.all([`,
    branchPromises,
    `${pad}]);`,
    `${pad}stepOutputs[${sid}] = { success: true, output: { branches: ${branches.length} } };`,
    `${pad}await onStepCompleted?.({ workflowRunId: run.id, stepId: ${sid} });`,
    `${pad}// join: ${joinId}`,
    `${pad}await onStepStarted?.({ workflowRunId: run.id, stepId: ${jid} });`,
    `${pad}stepOutputs[${jid}] = { success: true, output: { branches: [${branchBindings.join(', ')}] } };`,
    `${pad}await onStepCompleted?.({ workflowRunId: run.id, stepId: ${jid} });`,
  ].join('\n');
}

// ── Last-id helper ─────────────────────────────────────────────────────────

function lastIdOf(block: Block): string | undefined {
  if (block.kind === 'leaf') return block.nodeId;
  if (block.kind === 'sequence') {
    for (let i = block.steps.length - 1; i >= 0; i--) {
      const id = lastIdOf(block.steps[i]);
      if (id) return id;
    }
    return undefined;
  }
  if (block.kind === 'if-else') return block.head;
  if (block.kind === 'loop') return block.head;
  if (block.kind === 'parallel') return block.join;
  return undefined;
}

// unused suppressor for bindings variable (bindings generated in promise loop)
void resultBindingName;
