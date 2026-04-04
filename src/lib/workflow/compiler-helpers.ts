import ts from 'typescript';
import type { WorkflowStep } from './types';

export const DEFAULT_AGENT_STEP_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_NOTIFICATION_STEP_TIMEOUT_MS = 15_000;
export const DEFAULT_CAPABILITY_STEP_TIMEOUT_MS = 2 * 60 * 1000;
export const DEFAULT_WAIT_STEP_TIMEOUT_BUFFER_MS = 5_000;
export const DEFAULT_STEP_MAXIMUM_ATTEMPTS = 1;

export function resultBindingName(stepId: string): string {
  return `__result_${toSafeIdentifier(stepId)}`;
}

export function resolvedInputBindingName(stepId: string): string {
  return `__input_${toSafeIdentifier(stepId)}`;
}

export function runtimeContextBindingName(stepId: string): string {
  return `__runtime_${toSafeIdentifier(stepId)}`;
}

export function toSafeIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

export function emitLiteral(value: unknown): string {
  return JSON.stringify(value);
}

export function emitTimeoutLiteral(timeoutMs: number | undefined): string {
  return timeoutMs === undefined ? 'undefined' : String(timeoutMs);
}

export function resolveCompiledStepTimeoutMs(step: WorkflowStep): number | undefined {
  const explicitTimeoutMs = step.policy?.timeoutMs;
  if (typeof explicitTimeoutMs === 'number' && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }

  switch (step.type) {
    case 'agent':
      return DEFAULT_AGENT_STEP_TIMEOUT_MS;
    case 'notification':
      return DEFAULT_NOTIFICATION_STEP_TIMEOUT_MS;
    case 'capability':
      return DEFAULT_CAPABILITY_STEP_TIMEOUT_MS;
    case 'wait': {
      const durationMs = typeof step.input?.durationMs === 'number' && Number.isFinite(step.input.durationMs)
        ? Math.max(0, step.input.durationMs)
        : 1000;
      return durationMs + DEFAULT_WAIT_STEP_TIMEOUT_BUFFER_MS;
    }
    default:
      return undefined;
  }
}

export function createStepRunConfig(step: WorkflowStep): Record<string, unknown> {
  const config: Record<string, unknown> = { name: step.id };
  const maximumAttempts = step.policy?.retry?.maximumAttempts ?? DEFAULT_STEP_MAXIMUM_ATTEMPTS;
  config.retryPolicy = { maximumAttempts };
  return config;
}

export function validateCompiledWorkflowCode(code: string): string[] {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
    fileName: 'generated-workflow.ts',
  });

  return (result.diagnostics ?? [])
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      const lineInfo = d.file && d.start !== undefined
        ? d.file.getLineAndCharacterOfPosition(d.start)
        : null;
      if (!lineInfo) return `compiled-code: ${message}`;
      return `compiled-code:${lineInfo.line + 1}:${lineInfo.character + 1}: ${message}`;
    });
}

/** Shared runtime helpers emitted into all compiled workflow modules */
export function emitRuntimeHelpers(): string[] {
  return [
    'function __getByPath(source, path) {',
    '  let current = source;',
    '  for (const segment of path) {',
    '    if (current === null || current === undefined) return undefined;',
    '    current = current[segment];',
    '  }',
    '  return current;',
    '}',
    '',
    'function __resolveRef(ref, input, stepOutputs) {',
    "  if (ref === 'input') return input;",
    "  if (typeof ref === 'string' && ref.startsWith('input.')) {",
    "    return __getByPath(input, ref.slice('input.'.length).split('.'));",
    '  }',
    "  const stepMatch = /^steps\\.([A-Za-z0-9_-]+)(?:\\.(success|error|output|metadata)(?:\\.(.+))?)?$/.exec(ref);",
    '  if (!stepMatch) throw new Error(`Unsupported reference: ${String(ref)}`);',
    '  const stepResult = stepOutputs[stepMatch[1]];',
    "  if (!stepResult || typeof stepResult !== 'object') return undefined;",
    "  if (!stepMatch[2]) return stepResult;",
    "  if (stepMatch[2] === 'output') {",
    "    const stepOutput = stepResult.output;",
    '    if (stepMatch[3] === undefined) return stepOutput;',
    "    return __getByPath(stepOutput, stepMatch[3].split('.'));",
    '  }',
    "  const nsValue = stepResult[stepMatch[2]];",
    '  if (stepMatch[3] === undefined) return nsValue;',
    "  return __getByPath(nsValue, stepMatch[3].split('.'));",
    '}',
    '',
    'function __resolveValue(value, input, stepOutputs) {',
    "  if (typeof value === 'string') {",
    "    if (value === 'input' || value.startsWith('input.') || value.startsWith('steps.')) {",
    '      return __resolveRef(value, input, stepOutputs);',
    '    }',
    "    if (value.includes('{{')) {",
    "      return value.replace(/\\{\\{([^}]+)\\}\\}/g, (_, ref) => {",
    '        const resolved = __resolveRef(ref.trim(), input, stepOutputs);',
    "        return resolved !== undefined && resolved !== null ? String(resolved) : '';",
    '      });',
    '    }',
    '  }',
    '  if (Array.isArray(value)) return value.map((e) => __resolveValue(e, input, stepOutputs));',
    "  if (value && typeof value === 'object') {",
    '    const resolved = {};',
    '    for (const [key, entry] of Object.entries(value)) resolved[key] = __resolveValue(entry, input, stepOutputs);',
    '    return resolved;',
    '  }',
    '  return value;',
    '}',
    '',
    'function __attachRuntimeContext(value, runtimeContext) {',
    "  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value, __runtime: runtimeContext };",
    '  return value;',
    '}',
    '',
    'function __resolveRuntimeContext(input, baseRuntimeContext) {',
    "  if (!input || typeof input !== 'object' || Array.isArray(input)) return baseRuntimeContext;",
    '  const reserved = input.__lumosRuntime;',
    "  if (!reserved || typeof reserved !== 'object' || Array.isArray(reserved)) return baseRuntimeContext;",
    '  const runtimeContext = { ...baseRuntimeContext };',
    "  if (typeof reserved.taskId === 'string' && reserved.taskId.trim()) runtimeContext.taskId = reserved.taskId;",
    "  if (typeof reserved.sessionId === 'string' && reserved.sessionId.trim()) runtimeContext.sessionId = reserved.sessionId;",
    "  if (typeof reserved.requestedModel === 'string' && reserved.requestedModel.trim()) runtimeContext.requestedModel = reserved.requestedModel;",
    "  if (typeof reserved.workingDirectory === 'string' && reserved.workingDirectory.trim()) runtimeContext.workingDirectory = reserved.workingDirectory;",
    '  return runtimeContext;',
    '}',
    '',
    'function __hasValue(value) {',
    '  return value !== undefined && value !== null;',
    '}',
    '',
    'function __evaluateCondition(condition, input, stepOutputs) {',
    '  if (!condition) return true;',
    "  if (condition.op === 'exists') return __hasValue(__resolveRef(condition.ref, input, stepOutputs));",
    "  if (condition.op === 'eq') return __resolveRef(condition.left, input, stepOutputs) === __resolveValue(condition.right, input, stepOutputs);",
    "  if (condition.op === 'neq') return __resolveRef(condition.left, input, stepOutputs) !== __resolveValue(condition.right, input, stepOutputs);",
    "  if (condition.op === 'gt') return __resolveRef(condition.left, input, stepOutputs) > __resolveValue(condition.right, input, stepOutputs);",
    "  if (condition.op === 'lt') return __resolveRef(condition.left, input, stepOutputs) < __resolveValue(condition.right, input, stepOutputs);",
    "  if (condition.op === 'and') return condition.conditions.every((c) => __evaluateCondition(c, input, stepOutputs));",
    "  if (condition.op === 'or') return condition.conditions.some((c) => __evaluateCondition(c, input, stepOutputs));",
    "  if (condition.op === 'not') return !__evaluateCondition(condition.condition, input, stepOutputs);",
    "  throw new Error(`Unsupported condition op: ${String(condition.op)}`);",
    '}',
    '',
    'function __withTimeout(promise, timeoutMs, stepId) {',
    "  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;",
    '  return new Promise((resolve, reject) => {',
    '    const timer = setTimeout(() => reject(new Error(`Step "${String(stepId)}" timed out after ${String(timeoutMs)}ms`)), timeoutMs);',
    '    Promise.resolve(promise).then(',
    '      (v) => { clearTimeout(timer); resolve(v); },',
    '      (e) => { clearTimeout(timer); reject(e); }',
    '    );',
    '  });',
    '}',
    '',
    'async function __executeStep(options) {',
    '  const { workflowRunId, stepId, runStep, onStepStarted, onStepCompleted } = options;',
    '  await onStepStarted?.({ workflowRunId, stepId });',
    '  const result = await runStep();',
    '  await onStepCompleted?.({ workflowRunId, stepId });',
    '  if (!result.success) {',
    '    const err = new Error(result.error || `Step "${String(stepId)}" failed`);',
    '    err.stepName = stepId;',
    '    throw err;',
    '  }',
    '  return result;',
    '}',
    '',
    '// continueOnFailure: stores result without throwing so if-else can reference steps.X.success',
    'async function __executeStepSafe(options) {',
    '  const { workflowRunId, stepId, runStep, onStepStarted, onStepCompleted } = options;',
    '  await onStepStarted?.({ workflowRunId, stepId });',
    '  const result = await runStep();',
    '  await onStepCompleted?.({ workflowRunId, stepId });',
    '  return result;',
    '}',
  ];
}
