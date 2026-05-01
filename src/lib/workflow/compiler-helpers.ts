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
    'class __RefResolutionError extends Error {',
    "  constructor(ref, reason) { super(`Reference \"${ref}\" failed: ${reason}`); this.name = 'RefResolutionError'; this.ref = ref; this.reason = reason; }",
    '}',
    '',
    '// Parse "steps.x.output.foo?.bar ?? \'default\'" into { expr, defaultLiteral }.',
    'function __splitRefDefault(raw) {',
    "  const m = /^(.*?)\\s*\\?\\?\\s*(.*)$/.exec(raw);",
    '  if (!m) return { expr: raw, defaultLiteral: undefined };',
    '  const lit = m[2].trim();',
    "  let value;",
    '  try { value = JSON.parse(lit); } catch (_e) { value = lit.replace(/^\"|\"$/g, \'\').replace(/^\\\'|\\\'$/g, \'\'); }',
    '  return { expr: m[1].trim(), defaultLiteral: value };',
    '}',
    '',
    '// Split a path string like "output.foo?.bar.baz" into [{key:"output", optional:false}, ...]',
    'function __splitSegments(path) {',
    '  if (!path) return [];',
    "  const re = /(\\??\\.)?([A-Za-z_][A-Za-z0-9_]*|\\[[^\\]]+\\])/g;",
    '  const out = [];',
    '  let m;',
    '  while ((m = re.exec(path))) {',
    "    const optional = m[1] === '?.';",
    '      let key = m[2];',
    "    if (key.startsWith('[') && key.endsWith(']')) {",
    '        const inner = key.slice(1, -1).trim();',
    '        try { key = JSON.parse(inner); } catch (_e) { key = inner; }',
    '    }',
    '    out.push({ key, optional });',
    '  }',
    '  return out;',
    '}',
    '',
    'function __walkPath(source, segments) {',
    '  let current = source;',
    '  for (const seg of segments) {',
    '    if (current === null || current === undefined) {',
    '      if (seg.optional) return undefined;',
    '      return undefined;',
    '    }',
    '    current = current[seg.key];',
    '  }',
    '  return current;',
    '}',
    '',
    'function __resolveRefCore(expr, input, stepOutputs, state) {',
    "  if (expr === 'input') return input;",
    "  if (expr.startsWith('input.') || expr.startsWith('input?.')) {",
    "    return __walkPath(input, __splitSegments(expr.replace(/^input/, '')));",
    '  }',
    "  if (expr === 'state') return state;",
    "  if (expr.startsWith('state.') || expr.startsWith('state?.')) {",
    '    if (state === undefined || state === null) return undefined;',
    "    return __walkPath(state, __splitSegments(expr.replace(/^state/, '')));",
    '  }',
    "  const stepMatch = /^steps\\.([A-Za-z0-9_-]+)(\\??\\.(success|error|output|metadata))?(.*)$/.exec(expr);",
    "  if (!stepMatch) throw new __RefResolutionError(expr, 'unsupported reference syntax');",
    '  const stepId = stepMatch[1];',
    '  const stepResult = stepOutputs[stepId];',
    '  if (stepResult === undefined || stepResult === null) return undefined;',
    "  if (typeof stepResult !== 'object') return stepResult;",
    '  if (!stepMatch[3]) return stepResult;',
    '  const nsValue = stepResult[stepMatch[3]];',
    '  const tail = stepMatch[4] || "";',
    '  if (!tail) return nsValue;',
    '  if (nsValue === undefined || nsValue === null) {',
    "    const firstSeg = __splitSegments(tail)[0];",
    '    if (firstSeg && firstSeg.optional) return undefined;',
    '    return undefined;',
    '  }',
    '  return __walkPath(nsValue, __splitSegments(tail));',
    '}',
    '',
    'function __resolveRef(ref, input, stepOutputs, state) {',
    "  if (typeof ref !== 'string') return ref;",
    '  const { expr, defaultLiteral } = __splitRefDefault(ref);',
    '  const resolved = __resolveRefCore(expr, input, stepOutputs, state);',
    '  if (resolved === undefined || resolved === null) {',
    '    if (defaultLiteral !== undefined) return defaultLiteral;',
    '  }',
    '  return resolved;',
    '}',
    '',
    '// Format a resolved value for {{...}} template interpolation:',
    '// - undefined/null → empty string',
    '// - objects/arrays → JSON-stringified (prevents "[object Object]")',
    '// - everything else → String()',
    'function __formatForTemplate(value) {',
    "  if (value === undefined || value === null) return '';",
    "  if (typeof value === 'object') { try { return JSON.stringify(value); } catch (_e) { return String(value); } }",
    '  return String(value);',
    '}',
    '',
    '// A ref expression string is one we should resolve (vs. plain text).',
    'function __looksLikeRefExpr(s) {',
    "  return s === 'input' || s === 'state' || s.startsWith('input.') || s.startsWith('input?.') || s.startsWith('state.') || s.startsWith('state?.') || s.startsWith('steps.');",
    '}',
    '',
    'function __resolveValue(value, input, stepOutputs, state) {',
    "  if (typeof value === 'string') {",
    '    if (__looksLikeRefExpr(value)) return __resolveRef(value, input, stepOutputs, state);',
    "    if (value.includes('{{')) {",
    "      return value.replace(/\\{\\{([^}]+)\\}\\}/g, (_, ref) => __formatForTemplate(__resolveRef(ref.trim(), input, stepOutputs, state)));",
    '    }',
    '  }',
    '  if (Array.isArray(value)) return value.map((e) => __resolveValue(e, input, stepOutputs, state));',
    "  if (value && typeof value === 'object') {",
    '    const resolved = {};',
    '    for (const [key, entry] of Object.entries(value)) resolved[key] = __resolveValue(entry, input, stepOutputs, state);',
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
    "  if (typeof reserved.browserContextId === 'string' && reserved.browserContextId.trim()) runtimeContext.browserContextId = reserved.browserContextId;",
    '  return runtimeContext;',
    '}',
    '',
    'function __hasValue(value) {',
    '  return value !== undefined && value !== null;',
    '}',
    '',
    'function __evaluateCondition(condition, input, stepOutputs, state) {',
    '  if (!condition) return true;',
    "  if (condition.op === 'exists') return __hasValue(__resolveRef(condition.ref, input, stepOutputs, state));",
    "  if (condition.op === 'eq') return __resolveRef(condition.left, input, stepOutputs, state) === __resolveValue(condition.right, input, stepOutputs, state);",
    "  if (condition.op === 'neq') return __resolveRef(condition.left, input, stepOutputs, state) !== __resolveValue(condition.right, input, stepOutputs, state);",
    "  if (condition.op === 'gt') return __resolveRef(condition.left, input, stepOutputs, state) > __resolveValue(condition.right, input, stepOutputs, state);",
    "  if (condition.op === 'lt') return __resolveRef(condition.left, input, stepOutputs, state) < __resolveValue(condition.right, input, stepOutputs, state);",
    "  if (condition.op === 'and') return condition.conditions.every((c) => __evaluateCondition(c, input, stepOutputs, state));",
    "  if (condition.op === 'or') return condition.conditions.some((c) => __evaluateCondition(c, input, stepOutputs, state));",
    "  if (condition.op === 'not') return !__evaluateCondition(condition.condition, input, stepOutputs, state);",
    "  throw new Error(`Unsupported condition op: ${String(condition.op)}`);",
    '}',
    '',
    'function __mergeState(prev, partial) {',
    "  if (partial === null || partial === undefined) return prev;",
    "  if (typeof partial !== 'object' || Array.isArray(partial)) return partial;",
    "  if (prev === null || prev === undefined || typeof prev !== 'object' || Array.isArray(prev)) return { ...partial };",
    '  return { ...prev, ...partial };',
    '}',
    '',
    'function __withTimeout(promise, timeoutMs, stepId) {',
    "  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;",
    '  return new Promise((resolve, reject) => {',
    '    const timer = setTimeout(() => {',
    '      const err = new Error(`Step "${String(stepId)}" timed out after ${String(timeoutMs)}ms`);',
    '      err.stepName = stepId;',
    '      reject(err);',
    '    }, timeoutMs);',
    '    Promise.resolve(promise).then(',
    '      (v) => { clearTimeout(timer); resolve(v); },',
    '      (e) => { clearTimeout(timer); reject(e); }',
    '    );',
    '  });',
    '}',
    '',
    'async function __executeStep(options) {',
    '  const { workflowRunId, stepId, runStep, onStepStarted, onStepCompleted, retryPolicy } = options;',
    '  const maxAttempts = retryPolicy?.maximumAttempts ?? 1;',
    '  let lastError;',
    '  for (let attempt = 1; attempt <= maxAttempts; attempt++) {',
    '    if (attempt > 1) {',
    '      const delay = Math.min(1000 * Math.pow(2, attempt - 2), 30000);',
    '      await new Promise(r => setTimeout(r, delay));',
    '    }',
    '    await onStepStarted?.({ workflowRunId, stepId, attempt, maxAttempts });',
    '    try {',
    '      const result = await runStep();',
    '      await onStepCompleted?.({ workflowRunId, stepId, attempt, maxAttempts });',
    '      if (!result.success) {',
    '        if (result.error?.retryable !== false && attempt < maxAttempts) {',
    '          lastError = new Error(result.error || `Step "${String(stepId)}" failed`);',
    '          lastError.stepName = stepId;',
    '          continue;',
    '        }',
    '        const err = new Error(result.error || `Step "${String(stepId)}" failed`);',
    '        err.stepName = stepId;',
    '        throw err;',
    '      }',
    '      return result;',
    '    } catch (err) {',
    "      if (err && typeof err === 'object') err.stepName = err.stepName || stepId;",
    '      if (attempt < maxAttempts) { lastError = err; continue; }',
    '      throw err;',
    '    }',
    '  }',
    '  throw lastError;',
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
