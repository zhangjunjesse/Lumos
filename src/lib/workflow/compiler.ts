import ts from 'typescript';
import {
  assertValidWorkflowDsl,
  buildCompiledWorkflowManifest,
  buildExecutionLayers,
  createWorkflowVersion,
  validateWorkflowDsl,
} from './dsl';
import { getStepCompilerDefinition } from './step-registry';
import type {
  GenerateWorkflowResult,
  WorkflowDSL,
  WorkflowStep,
} from './types';

export function generateWorkflow(input: { spec: WorkflowDSL }): GenerateWorkflowResult {
  const validation = validateWorkflowDsl(input.spec);
  const fallbackVersion = validation.valid ? createWorkflowVersion(input.spec) : 'dsl-v1-invalid';

  if (!validation.valid) {
    return {
      code: '',
      manifest: buildCompiledWorkflowManifest(input.spec, fallbackVersion),
      validation,
    };
  }

  const code = compileWorkflowDsl(input.spec);
  const codeValidationErrors = validateCompiledWorkflowCode(code);

  return {
    code,
    manifest: buildCompiledWorkflowManifest(input.spec, createWorkflowVersion(input.spec)),
    validation: {
      valid: validation.valid && codeValidationErrors.length === 0,
      errors: [...validation.errors, ...codeValidationErrors],
    },
  };
}

export function compileWorkflowDsl(spec: WorkflowDSL): string {
  assertValidWorkflowDsl(spec);

  const workflowVersion = createWorkflowVersion(spec);
  const layers = buildExecutionLayers(spec.steps);
  const body = layers.map((layer) => emitLayer(layer)).join('\n\n');

  return wrapWorkflowModule(spec.name, workflowVersion, body);
}

function emitLayer(layer: WorkflowStep[]): string {
  if (layer.length === 1) {
    return emitSequentialStep(layer[0]);
  }

  return emitParallelLayer(layer);
}

function emitSequentialStep(step: WorkflowStep): string {
  const bindingName = resultBindingName(step.id);
  const resolvedInputName = resolvedInputBindingName(step.id);
  const runtimeContextName = runtimeContextBindingName(step.id);
  const definition = getStepCompilerDefinition(step.type);

  if (!definition) {
    throw new Error(`Unknown step type: ${step.type}`);
  }

  const conditionLiteral = emitLiteral(step.when ?? null);
  const inputLiteral = emitLiteral(step.input ?? {});
  const configLiteral = emitLiteral(createStepRunConfig(step));
  const timeoutLiteral = emitTimeoutLiteral(step.policy?.timeoutMs);

  return [
    `      if (__evaluateCondition(${conditionLiteral}, input, stepOutputs)) {`,
    `        const ${runtimeContextName} = __resolveRuntimeContext(input, { workflowRunId: run.id, stepId: ${emitLiteral(step.id)}, stepType: ${emitLiteral(step.type)}, timeoutMs: ${timeoutLiteral} });`,
    `        const ${resolvedInputName} = __attachRuntimeContext(`,
    `          __resolveValue(${inputLiteral}, input, stepOutputs),`,
    `          ${runtimeContextName}`,
    '        );',
    `        const ${bindingName} = await step.run(`,
    `          ${configLiteral},`,
    `          () => __executeStep({`,
    `            workflowRunId: run.id,`,
    `            stepId: ${emitLiteral(step.id)},`,
    `            runStep: () => __withTimeout(`,
    `              ${definition.runtimeBinding}(${resolvedInputName}),`,
    `              ${timeoutLiteral},`,
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
    .map((step, index) => `      stepOutputs[${emitLiteral(step.id)}] = ${bindings[index]};`)
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
  const runtimeContextName = runtimeContextBindingName(step.id);
  const definition = getStepCompilerDefinition(step.type);

  if (!definition) {
    throw new Error(`Unknown step type: ${step.type}`);
  }

  const conditionLiteral = emitLiteral(step.when ?? null);
  const inputLiteral = emitLiteral(step.input ?? {});
  const configLiteral = emitLiteral(createStepRunConfig(step));
  const timeoutLiteral = emitTimeoutLiteral(step.policy?.timeoutMs);

  return [
    '        (async () => {',
    `          if (!__evaluateCondition(${conditionLiteral}, input, stepOutputs)) {`,
    `            await onStepSkipped?.({ workflowRunId: run.id, stepId: ${emitLiteral(step.id)} });`,
    '            return null;',
    '          }',
    '',
    `          const ${runtimeContextName} = __resolveRuntimeContext(input, { workflowRunId: run.id, stepId: ${emitLiteral(step.id)}, stepType: ${emitLiteral(step.type)}, timeoutMs: ${timeoutLiteral} });`,
    `          const ${resolvedInputName} = __attachRuntimeContext(`,
    `            __resolveValue(${inputLiteral}, input, stepOutputs),`,
    `            ${runtimeContextName}`,
    '          );',
    '          return step.run(',
    `            ${configLiteral},`,
    '            () => __executeStep({',
    '              workflowRunId: run.id,',
    `              stepId: ${emitLiteral(step.id)},`,
    '              runStep: () => __withTimeout(',
    `                ${definition.runtimeBinding}(${resolvedInputName}),`,
    `                ${timeoutLiteral},`,
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
  return [
    "import { defineWorkflow } from 'openworkflow';",
    '',
    'function __getByPath(source, path) {',
    '  let current = source;',
    '  for (const segment of path) {',
    '    if (current === null || current === undefined) {',
    '      return undefined;',
    '    }',
    '    current = current[segment];',
    '  }',
    '  return current;',
    '}',
    '',
    'function __resolveRef(ref, input, stepOutputs) {',
    "  if (ref === 'input') {",
    '    return input;',
    '  }',
    '',
    "  if (typeof ref === 'string' && ref.startsWith('input.')) {",
    "    return __getByPath(input, ref.slice('input.'.length).split('.'));",
    '  }',
    '',
    "  const stepMatch = /^steps\\.([A-Za-z0-9_-]+)\\.(output)(?:\\.(.+))?$/.exec(ref);",
    '  if (!stepMatch) {',
    "    throw new Error(`Unsupported reference: ${String(ref)}`);",
    '  }',
    '',
    '  const stepResult = stepOutputs[stepMatch[1]];',
    "  if (stepMatch[2] !== 'output') {",
    "    throw new Error(`Unsupported step reference namespace: ${String(stepMatch[2])}`);",
    '  }',
    '',
    "  const stepOutput = stepResult && typeof stepResult === 'object' ? stepResult.output : undefined;",
    '  if (stepMatch[3] === undefined) {',
    '    return stepOutput;',
    '  }',
    '',
    "  return __getByPath(stepOutput, stepMatch[3].split('.'));",
    '}',
    '',
    'function __resolveValue(value, input, stepOutputs) {',
    "  if (typeof value === 'string' && (value === 'input' || value.startsWith('input.') || value.startsWith('steps.'))) {",
    '    return __resolveRef(value, input, stepOutputs);',
    '  }',
    '',
    '  if (Array.isArray(value)) {',
    '    return value.map((entry) => __resolveValue(entry, input, stepOutputs));',
    '  }',
    '',
    "  if (value && typeof value === 'object') {",
    '    const resolved = {};',
    '    for (const [key, entry] of Object.entries(value)) {',
    '      resolved[key] = __resolveValue(entry, input, stepOutputs);',
    '    }',
    '    return resolved;',
    '  }',
    '',
    '  return value;',
    '}',
    '',
    'function __attachRuntimeContext(value, runtimeContext) {',
    "  if (value && typeof value === 'object' && !Array.isArray(value)) {",
    '    return { ...value, __runtime: runtimeContext };',
    '  }',
    '  return value;',
    '}',
    '',
    'function __resolveRuntimeContext(input, baseRuntimeContext) {',
    "  if (!input || typeof input !== 'object' || Array.isArray(input)) {",
    '    return baseRuntimeContext;',
    '  }',
    '',
    '  const reserved = input.__lumosRuntime;',
    "  if (!reserved || typeof reserved !== 'object' || Array.isArray(reserved)) {",
    '    return baseRuntimeContext;',
    '  }',
    '',
    '  const runtimeContext = { ...baseRuntimeContext };',
    "  if (typeof reserved.taskId === 'string' && reserved.taskId.trim()) {",
    '    runtimeContext.taskId = reserved.taskId;',
    '  }',
    "  if (typeof reserved.sessionId === 'string' && reserved.sessionId.trim()) {",
    '    runtimeContext.sessionId = reserved.sessionId;',
    '  }',
    "  if (typeof reserved.requestedModel === 'string' && reserved.requestedModel.trim()) {",
    '    runtimeContext.requestedModel = reserved.requestedModel;',
    '  }',
    "  if (typeof reserved.workingDirectory === 'string' && reserved.workingDirectory.trim()) {",
    '    runtimeContext.workingDirectory = reserved.workingDirectory;',
    '  }',
    '',
    '  return runtimeContext;',
    '}',
    '',
    'function __hasValue(value) {',
    '  return value !== undefined && value !== null;',
    '}',
    '',
    'function __evaluateCondition(condition, input, stepOutputs) {',
    '  if (!condition) {',
    '    return true;',
    '  }',
    '',
    "  if (condition.op === 'exists') {",
    '    return __hasValue(__resolveRef(condition.ref, input, stepOutputs));',
    '  }',
    '',
    "  if (condition.op === 'eq') {",
    '    return __resolveRef(condition.left, input, stepOutputs) === __resolveValue(condition.right, input, stepOutputs);',
    '  }',
    '',
    "  if (condition.op === 'neq') {",
    '    return __resolveRef(condition.left, input, stepOutputs) !== __resolveValue(condition.right, input, stepOutputs);',
    '  }',
    '',
    "  throw new Error(`Unsupported condition op: ${String(condition.op)}`);",
    '}',
    '',
    'function __withTimeout(promise, timeoutMs, stepId) {',
    "  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {",
    '    return promise;',
    '  }',
    '',
    '  return new Promise((resolve, reject) => {',
    '    const timer = setTimeout(() => {',
    '      reject(new Error(`Step "${String(stepId)}" timed out after ${String(timeoutMs)}ms`));',
    '    }, timeoutMs);',
    '',
    '    Promise.resolve(promise).then(',
    '      (value) => {',
    '        clearTimeout(timer);',
    '        resolve(value);',
    '      },',
    '      (error) => {',
    '        clearTimeout(timer);',
    '        reject(error);',
    '      }',
    '    );',
    '  });',
    '}',
    '',
    'async function __executeStep(options) {',
    '  const { workflowRunId, stepId, runStep, onStepStarted, onStepCompleted } = options;',
    '  await onStepStarted?.({ workflowRunId, stepId });',
    '  const result = await runStep();',
    '  await onStepCompleted?.({ workflowRunId, stepId });',
    '  return result;',
    '}',
    '',
    'export function buildWorkflow(runtime) {',
    '  const {',
    '    agentStep,',
    '    browserStep,',
    '    notificationStep,',
    '    capabilityStep,',
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

function createStepRunConfig(step: WorkflowStep): Record<string, unknown> {
  const config: Record<string, unknown> = {
    name: step.id,
  };

  const maximumAttempts = step.policy?.retry?.maximumAttempts;
  if (maximumAttempts !== undefined) {
    config.retryPolicy = { maximumAttempts };
  }

  return config;
}

function resultBindingName(stepId: string): string {
  return `__result_${toSafeIdentifier(stepId)}`;
}

function resolvedInputBindingName(stepId: string): string {
  return `__input_${toSafeIdentifier(stepId)}`;
}

function runtimeContextBindingName(stepId: string): string {
  return `__runtime_${toSafeIdentifier(stepId)}`;
}

function toSafeIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

function emitLiteral(value: unknown): string {
  return JSON.stringify(value);
}

function emitTimeoutLiteral(timeoutMs: number | undefined): string {
  return timeoutMs === undefined ? 'undefined' : String(timeoutMs);
}

function validateCompiledWorkflowCode(code: string): string[] {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
    fileName: 'generated-workflow.ts',
  });

  return (result.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      const lineInfo = diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : null;

      if (!lineInfo) {
        return `compiled-code: ${message}`;
      }

      return `compiled-code:${lineInfo.line + 1}:${lineInfo.character + 1}: ${message}`;
    });
}
