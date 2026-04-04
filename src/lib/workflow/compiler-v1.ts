import {
  assertValidWorkflowDsl,
  buildExecutionLayers,
  createWorkflowVersion,
} from './dsl';
import { getStepCompilerDefinition } from './step-registry';
import {
  createStepRunConfig,
  emitLiteral,
  emitRuntimeHelpers,
  emitTimeoutLiteral,
  resolveCompiledStepTimeoutMs,
  resolvedInputBindingName,
  resultBindingName,
  runtimeContextBindingName,
} from './compiler-helpers';
import type { WorkflowDSL, WorkflowStep } from './types';

export function compileWorkflowDslV1(spec: WorkflowDSL): string {
  assertValidWorkflowDsl(spec);

  const workflowVersion = createWorkflowVersion(spec);
  const layers = buildExecutionLayers(spec.steps);
  const body = layers.map((layer) => emitLayer(layer)).join('\n\n');

  return wrapWorkflowModule(spec.name, workflowVersion, body);
}

function emitLayer(layer: WorkflowStep[]): string {
  if (layer.length === 1) return emitSequentialStep(layer[0]);
  return emitParallelLayer(layer);
}

function emitSequentialStep(step: WorkflowStep): string {
  const bindingName = resultBindingName(step.id);
  const resolvedInputName = resolvedInputBindingName(step.id);
  const rtxName = runtimeContextBindingName(step.id);
  const definition = getStepCompilerDefinition(step.type);
  if (!definition) throw new Error(`Unknown step type: ${step.type}`);

  const conditionLit = emitLiteral(step.when ?? null);
  const inputLit = emitLiteral(step.input ?? {});
  const configLit = emitLiteral(createStepRunConfig(step));
  const timeoutLit = emitTimeoutLiteral(resolveCompiledStepTimeoutMs(step));

  return [
    `      if (__evaluateCondition(${conditionLit}, input, stepOutputs)) {`,
    `        const ${rtxName} = __resolveRuntimeContext(input, { workflowRunId: run.id, stepId: ${emitLiteral(step.id)}, stepType: ${emitLiteral(step.type)}, timeoutMs: ${timeoutLit} });`,
    `        const ${resolvedInputName} = __attachRuntimeContext(`,
    `          __resolveValue(${inputLit}, input, stepOutputs),`,
    `          ${rtxName}`,
    '        );',
    `        const ${bindingName} = await step.run(`,
    `          ${configLit},`,
    `          () => __executeStep({`,
    `            workflowRunId: run.id,`,
    `            stepId: ${emitLiteral(step.id)},`,
    `            runStep: () => __withTimeout(`,
    `              ${definition.runtimeBinding}(${resolvedInputName}),`,
    `              ${timeoutLit},`,
    `              ${emitLiteral(step.id)}`,
    `            ),`,
    '            onStepStarted,',
    '            onStepCompleted',
    '          })',
    `        );`,
    `        stepOutputs[${emitLiteral(step.id)}] = ${bindingName};`,
    '      } else {',
    `        await onStepSkipped?.({ workflowRunId: run.id, stepId: ${emitLiteral(step.id)} });`,
    `        stepOutputs[${emitLiteral(step.id)}] = null;`,
    '      }',
  ].join('\n');
}

function emitParallelLayer(layer: WorkflowStep[]): string {
  const bindings = layer.map((step) => resultBindingName(step.id));
  const promises = layer.map((step) => emitParallelPromise(step)).join(',\n');
  const assignments = layer
    .map((step, i) => `      stepOutputs[${emitLiteral(step.id)}] = ${bindings[i]};`)
    .join('\n');

  return [
    `      const [${bindings.join(', ')}] = await Promise.all([`,
    promises,
    '      ]);',
    assignments,
  ].join('\n');
}

function emitParallelPromise(step: WorkflowStep): string {
  const resolvedInputName = resolvedInputBindingName(step.id);
  const rtxName = runtimeContextBindingName(step.id);
  const definition = getStepCompilerDefinition(step.type);
  if (!definition) throw new Error(`Unknown step type: ${step.type}`);

  const conditionLit = emitLiteral(step.when ?? null);
  const inputLit = emitLiteral(step.input ?? {});
  const configLit = emitLiteral(createStepRunConfig(step));
  const timeoutLit = emitTimeoutLiteral(resolveCompiledStepTimeoutMs(step));

  return [
    '        (async () => {',
    `          if (!__evaluateCondition(${conditionLit}, input, stepOutputs)) {`,
    `            await onStepSkipped?.({ workflowRunId: run.id, stepId: ${emitLiteral(step.id)} });`,
    '            return null;',
    '          }',
    '',
    `          const ${rtxName} = __resolveRuntimeContext(input, { workflowRunId: run.id, stepId: ${emitLiteral(step.id)}, stepType: ${emitLiteral(step.type)}, timeoutMs: ${timeoutLit} });`,
    `          const ${resolvedInputName} = __attachRuntimeContext(`,
    `            __resolveValue(${inputLit}, input, stepOutputs),`,
    `            ${rtxName}`,
    '          );',
    '          return step.run(',
    `            ${configLit},`,
    '            () => __executeStep({',
    '              workflowRunId: run.id,',
    `              stepId: ${emitLiteral(step.id)},`,
    '              runStep: () => __withTimeout(',
    `                ${definition.runtimeBinding}(${resolvedInputName}),`,
    `                ${timeoutLit},`,
    `                ${emitLiteral(step.id)}`,
    '              ),',
    '              onStepStarted,',
    '              onStepCompleted',
    '            })',
    '          );',
    '        })()',
  ].join('\n');
}

function wrapWorkflowModule(
  workflowName: string,
  workflowVersion: string,
  body: string
): string {
  const helpers = emitRuntimeHelpers();
  return [
    "import { defineWorkflow } from 'openworkflow';",
    '',
    ...helpers,
    '',
    'export function buildWorkflow(runtime) {',
    '  const {',
    '    agentStep,',
    '    notificationStep,',
    '    capabilityStep,',
    '    waitStep,',
    '    onStepStarted,',
    '    onStepCompleted,',
    '    onStepSkipped,',
    '  } = runtime;',
    '',
    '  return defineWorkflow(',
    `    { name: ${emitLiteral(workflowName)}, version: ${emitLiteral(workflowVersion)} },`,
    '    async ({ input, step, run }) => {',
    '      const stepOutputs = {};',
    body,
    '',
    '      return stepOutputs;',
    '    }',
    '  );',
    '}',
    '',
  ].join('\n');
}
