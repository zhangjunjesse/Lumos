import { getStepCompilerDefinition } from './step-registry';
import {
  createStepRunConfig,
  emitLiteral,
  emitTimeoutLiteral,
  resolveCompiledStepTimeoutMs,
  resolvedInputBindingName,
  resultBindingName,
  runtimeContextBindingName,
  toSafeIdentifier,
} from './compiler-helpers';
import type { WorkflowStep } from './types';
import { FOR_EACH_MAX_ITERATIONS_DEFAULT, WHILE_MAX_ITERATIONS_DEFAULT } from './types-v2';

type StepMap = Map<string, WorkflowStep>;

/** Dispatch to the right emitter based on step type */
export function emitStep(
  step: WorkflowStep,
  stepMap: StepMap,
  ownedStepIds: Set<string>,
  indent: number,
): string {
  switch (step.type) {
    case 'if-else': return emitIfElse(step, stepMap, ownedStepIds, indent);
    case 'for-each': return emitForEach(step, stepMap, ownedStepIds, indent);
    case 'while': return emitWhile(step, stepMap, ownedStepIds, indent);
    default: return emitAgentStep(step, indent);
  }
}

/** Emit a standard agent/notification/capability step */
export function emitAgentStep(step: WorkflowStep, indent: number): string {
  const pad = ' '.repeat(indent);
  const def = getStepCompilerDefinition(step.type);
  if (!def) throw new Error(`Unknown step type: ${step.type}`);

  const condLit = emitLiteral(step.when ?? null);
  const inputLit = emitLiteral(step.input ?? {});
  const configLit = emitLiteral(createStepRunConfig(step));
  const timeoutLit = emitTimeoutLiteral(resolveCompiledStepTimeoutMs(step));
  const bind = resultBindingName(step.id);
  const rInput = resolvedInputBindingName(step.id);
  const rtx = runtimeContextBindingName(step.id);
  const sid = emitLiteral(step.id);
  const stype = emitLiteral(step.type);

  const execFn = step.policy?.continueOnFailure ? '__executeStepSafe' : '__executeStep';

  return [
    `${pad}if (__evaluateCondition(${condLit}, input, stepOutputs)) {`,
    `${pad}  const ${rtx} = __resolveRuntimeContext(input, { workflowRunId: run.id, stepId: ${sid}, stepType: ${stype}, timeoutMs: ${timeoutLit} });`,
    `${pad}  const ${rInput} = __attachRuntimeContext(__resolveValue(${inputLit}, input, stepOutputs), ${rtx});`,
    `${pad}  const ${bind} = await step.run(${configLit}, () => ${execFn}({`,
    `${pad}    workflowRunId: run.id, stepId: ${sid},`,
    `${pad}    runStep: () => __withTimeout(${def.runtimeBinding}(${rInput}), ${timeoutLit}, ${sid}),`,
    `${pad}    onStepStarted, onStepCompleted`,
    `${pad}  }));`,
    `${pad}  stepOutputs[${sid}] = ${bind};`,
    `${pad}} else {`,
    `${pad}  await onStepSkipped?.({ workflowRunId: run.id, stepId: ${sid} });`,
    `${pad}  stepOutputs[${sid}] = null;`,
    `${pad}}`,
  ].join('\n');
}

function emitBodySteps(
  stepIds: string[],
  stepMap: StepMap,
  ownedStepIds: Set<string>,
  indent: number,
): string {
  const steps = stepIds.map(id => stepMap.get(id)).filter(Boolean) as WorkflowStep[];
  return steps.map(s => emitStep(s, stepMap, ownedStepIds, indent)).join('\n');
}

// ── if-else ────────────────────────────────────────────────────────────────

function emitIfElse(
  step: WorkflowStep, stepMap: StepMap, ownedStepIds: Set<string>, indent: number,
): string {
  const pad = ' '.repeat(indent);
  const input = step.input as Record<string, unknown>;
  const condLit = emitLiteral(input.condition);
  const thenIds = (input.then as string[]) ?? [];
  const elseIds = (input.else as string[] | undefined) ?? [];
  const sid = emitLiteral(step.id);

  const safe = toSafeIdentifier(step.id);
  const lines = [
    `${pad}// if-else: ${step.id.replace(/[\r\n]/g, ' ')}`,
    `${pad}await onStepStarted?.({ workflowRunId: run.id, stepId: ${sid} });`,
    `${pad}const __branch_${safe} = __evaluateCondition(${condLit}, input, stepOutputs);`,
    `${pad}if (__branch_${safe}) {`,
    emitBodySteps(thenIds, stepMap, ownedStepIds, indent + 2),
  ];

  if (elseIds.length > 0) {
    lines.push(
      `${pad}} else {`,
      emitBodySteps(elseIds, stepMap, ownedStepIds, indent + 2),
    );
  }

  lines.push(
    `${pad}}`,
    `${pad}stepOutputs[${sid}] = { output: { branch: __branch_${safe} ? "then" : "else" } };`,
    `${pad}await onStepCompleted?.({ workflowRunId: run.id, stepId: ${sid} });`,
  );
  return lines.join('\n');
}

// ── for-each ───────────────────────────────────────────────────────────────

function emitForEach(
  step: WorkflowStep, stepMap: StepMap, ownedStepIds: Set<string>, indent: number,
): string {
  const pad = ' '.repeat(indent);
  const input = step.input as Record<string, unknown>;
  const collectionRef = input.collection as string;
  const itemVar = (input.itemVar as string) || 'item';
  const bodyIds = (input.body as string[]) ?? [];
  const maxIter = typeof input.maxIterations === 'number'
    ? input.maxIterations : FOR_EACH_MAX_ITERATIONS_DEFAULT;
  const sid = emitLiteral(step.id);
  const safe = toSafeIdentifier(step.id);
  const lastBodyId = bodyIds[bodyIds.length - 1];

  return [
    `${pad}// for-each: ${step.id.replace(/[\r\n]/g, ' ')}`,
    `${pad}await onStepStarted?.({ workflowRunId: run.id, stepId: ${sid} });`,
    `${pad}const __col_${safe} = __resolveRef(${emitLiteral(collectionRef)}, input, stepOutputs);`,
    `${pad}const __items_${safe} = Array.isArray(__col_${safe}) ? __col_${safe} : [];`,
    `${pad}const __results_${safe} = [];`,
    `${pad}for (let __i_${safe} = 0; __i_${safe} < Math.min(__items_${safe}.length, ${maxIter}); __i_${safe}++) {`,
    `${pad}  stepOutputs[${sid}] = { output: { ${itemVar}: __items_${safe}[__i_${safe}], index: __i_${safe} } };`,
    emitBodySteps(bodyIds, stepMap, ownedStepIds, indent + 2),
    lastBodyId ? `${pad}  __results_${safe}.push(stepOutputs[${emitLiteral(lastBodyId)}]);` : '',
    `${pad}}`,
    `${pad}stepOutputs[${sid}] = { output: { results: __results_${safe}, count: __results_${safe}.length } };`,
    `${pad}await onStepCompleted?.({ workflowRunId: run.id, stepId: ${sid} });`,
  ].filter(Boolean).join('\n');
}

// ── while ──────────────────────────────────────────────────────────────────

function emitWhile(
  step: WorkflowStep, stepMap: StepMap, ownedStepIds: Set<string>, indent: number,
): string {
  const pad = ' '.repeat(indent);
  const input = step.input as Record<string, unknown>;
  const condLit = emitLiteral(input.condition);
  const bodyIds = (input.body as string[]) ?? [];
  const maxIter = typeof input.maxIterations === 'number'
    ? input.maxIterations : WHILE_MAX_ITERATIONS_DEFAULT;
  const sid = emitLiteral(step.id);
  const safe = toSafeIdentifier(step.id);

  return [
    `${pad}// while: ${step.id.replace(/[\r\n]/g, ' ')}`,
    `${pad}await onStepStarted?.({ workflowRunId: run.id, stepId: ${sid} });`,
    `${pad}let __iter_${safe} = 0;`,
    `${pad}while (__evaluateCondition(${condLit}, input, stepOutputs) && __iter_${safe} < ${maxIter}) {`,
    emitBodySteps(bodyIds, stepMap, ownedStepIds, indent + 2),
    `${pad}  __iter_${safe}++;`,
    `${pad}}`,
    `${pad}stepOutputs[${sid}] = { output: { iterations: __iter_${safe} } };`,
    `${pad}await onStepCompleted?.({ workflowRunId: run.id, stepId: ${sid} });`,
  ].join('\n');
}
