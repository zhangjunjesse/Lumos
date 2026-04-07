import { createHash } from 'crypto';
import { z } from 'zod';
import { resolveCompiledStepTimeoutMs } from './compiler-helpers';
import { getStepCompilerDefinition } from './step-registry';
import type {
  AnyWorkflowDSL,
  CompiledWorkflowManifest,
  ConditionExpr,
  GenerateWorkflowValidation,
  WorkflowDSL,
  WorkflowDSLV2,
  WorkflowStep,
  WorkflowStepType,
} from './types';

const SAFE_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const safeStepId = z.string().min(1).max(100).regex(SAFE_IDENTIFIER_RE, 'must be a safe identifier (letters, digits, hyphens, underscores; start with letter)');

const workflowStepPolicySchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  retry: z.object({
    maximumAttempts: z.number().int().positive().optional(),
  }).strict().optional(),
  continueOnFailure: z.boolean().optional(),
}).strict().optional();

const conditionExprV1Schema: z.ZodType<ConditionExpr> = z.union([
  z.object({
    op: z.literal('exists'),
    ref: z.string().min(1),
  }).strict(),
  z.object({
    op: z.literal('eq'),
    left: z.string().min(1),
    right: z.unknown(),
  }).strict(),
  z.object({
    op: z.literal('neq'),
    left: z.string().min(1),
    right: z.unknown(),
  }).strict(),
]);

const conditionExprSchema: z.ZodType<ConditionExpr> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal('exists'), ref: z.string().min(1) }).strict(),
    z.object({ op: z.literal('eq'), left: z.string().min(1), right: z.unknown() }).strict(),
    z.object({ op: z.literal('neq'), left: z.string().min(1), right: z.unknown() }).strict(),
    z.object({ op: z.literal('gt'), left: z.string().min(1), right: z.unknown() }).strict(),
    z.object({ op: z.literal('lt'), left: z.string().min(1), right: z.unknown() }).strict(),
    z.object({ op: z.literal('and'), conditions: z.array(conditionExprSchema).min(1) }).strict(),
    z.object({ op: z.literal('or'), conditions: z.array(conditionExprSchema).min(1) }).strict(),
    z.object({ op: z.literal('not'), condition: conditionExprSchema }).strict(),
  ])
);

const workflowParamDefSchema = z.object({
  name: z.string().min(1).max(50).regex(SAFE_IDENTIFIER_RE, 'param name must be a safe identifier'),
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string().max(200).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().optional(),
}).strict();

const stepMetadataSchema = z.object({
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  label: z.string().optional(),
}).strict().optional();

const workflowStepSchema = z.object({
  id: safeStepId,
  type: z.enum(['agent', 'notification', 'capability']),
  dependsOn: z.array(safeStepId).optional(),
  when: conditionExprV1Schema.optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  policy: workflowStepPolicySchema,
  metadata: stepMetadataSchema,
}).strict();

const workflowDslSchema: z.ZodType<WorkflowDSL> = z.object({
  version: z.literal('v1'),
  name: z.string().min(1),
  params: z.array(workflowParamDefSchema).max(20).optional(),
  steps: z.array(workflowStepSchema).min(1).max(20),
}).strict();

// ── V2 step schemas ─────────────────────────────────────────────────────────

const ifElseStepInputSchema = z.object({
  condition: conditionExprSchema,
  then: z.array(safeStepId).min(1),
  else: z.array(safeStepId).optional(),
}).strict();

const forEachStepInputSchema = z.object({
  collection: z.string().min(1),
  itemVar: z.string().min(1).regex(SAFE_IDENTIFIER_RE, 'itemVar must be a safe JS identifier'),
  body: z.array(safeStepId).min(1),
  maxIterations: z.number().int().positive().max(200).optional(),
}).strict();

const whileStepInputSchema = z.object({
  condition: conditionExprSchema,
  body: z.array(safeStepId).min(1),
  maxIterations: z.number().int().positive().max(100).optional(),
  mode: z.enum(['while', 'do-while']).optional(),
}).strict();

const workflowStepV2Schema = z.discriminatedUnion('type', [
  z.object({
    id: safeStepId,
    type: z.literal('agent'),
    dependsOn: z.array(safeStepId).optional(),
    when: conditionExprSchema.optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    policy: workflowStepPolicySchema,
    metadata: stepMetadataSchema,
  }),
  z.object({
    id: safeStepId,
    type: z.literal('notification'),
    dependsOn: z.array(safeStepId).optional(),
    when: conditionExprSchema.optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    policy: workflowStepPolicySchema,
    metadata: stepMetadataSchema,
  }),
  z.object({
    id: safeStepId,
    type: z.literal('capability'),
    dependsOn: z.array(safeStepId).optional(),
    when: conditionExprSchema.optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    policy: workflowStepPolicySchema,
    metadata: stepMetadataSchema,
  }),
  z.object({
    id: safeStepId,
    type: z.literal('wait'),
    dependsOn: z.array(safeStepId).optional(),
    when: conditionExprSchema.optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    policy: workflowStepPolicySchema,
    metadata: stepMetadataSchema,
  }),
  z.object({
    id: safeStepId,
    type: z.literal('if-else'),
    dependsOn: z.array(safeStepId).optional(),
    input: ifElseStepInputSchema,
    policy: workflowStepPolicySchema,
    metadata: stepMetadataSchema,
  }),
  z.object({
    id: safeStepId,
    type: z.literal('for-each'),
    dependsOn: z.array(safeStepId).optional(),
    input: forEachStepInputSchema,
    policy: workflowStepPolicySchema,
    metadata: stepMetadataSchema,
  }),
  z.object({
    id: safeStepId,
    type: z.literal('while'),
    dependsOn: z.array(safeStepId).optional(),
    input: whileStepInputSchema,
    policy: workflowStepPolicySchema,
    metadata: stepMetadataSchema,
  }),
]);

const workflowDslV2Schema: z.ZodType<WorkflowDSLV2> = z.object({
  version: z.literal('v2'),
  name: z.string().min(1),
  description: z.string().optional(),
  params: z.array(workflowParamDefSchema).max(20).optional(),
  steps: z.array(workflowStepV2Schema).min(1).max(50),
}) as z.ZodType<WorkflowDSLV2>;

const STEP_OUTPUT_REF_PATTERN = /^steps\.([A-Za-z0-9_-]+)\.output(?:\.(.+))?$/;

export function validateWorkflowDsl(spec: WorkflowDSL): GenerateWorkflowValidation {
  const errors: string[] = [];
  const base = workflowDslSchema.safeParse(spec);

  if (!base.success) {
    return {
      valid: false,
      errors: base.error.issues.map((issue) =>
        formatZodIssue(
          issue.path.map((segment) => typeof segment === 'symbol' ? segment.toString() : segment),
          issue.message
        )
      ),
    };
  }

  const stepIds = new Set<string>();
  const stepById = new Map<string, WorkflowStep>();

  for (const step of spec.steps) {
    if (stepIds.has(step.id)) {
      errors.push(`steps.${step.id}: duplicate step id`);
      continue;
    }

    stepIds.add(step.id);
    stepById.set(step.id, step);

    const definition = getStepCompilerDefinition(step.type);
    if (!definition) {
      errors.push(`steps.${step.id}: unsupported step type "${step.type}"`);
      continue;
    }

    const parsedInput = definition.inputSchema.safeParse(step.input ?? {});
    if (!parsedInput.success) {
      for (const issue of parsedInput.error.issues) {
        errors.push(
          formatZodIssue(
            ['steps', step.id, 'input', ...issue.path.map((segment) => String(segment))],
            issue.message
          )
        );
      }
    }

    const dependsOn = step.dependsOn ?? [];
    const seenDependsOn = new Set<string>();

    for (const dependency of dependsOn) {
      if (dependency === step.id) {
        errors.push(`steps.${step.id}.dependsOn: step cannot depend on itself`);
      }

      if (seenDependsOn.has(dependency)) {
        errors.push(`steps.${step.id}.dependsOn: duplicate dependency "${dependency}"`);
      }
      seenDependsOn.add(dependency);

      if (!stepById.has(dependency) && !stepIds.has(dependency)) {
        const existsLater = spec.steps.some((candidate) => candidate.id === dependency);
        if (!existsLater) {
          errors.push(`steps.${step.id}.dependsOn: unknown step "${dependency}"`);
        }
      }
    }
  }

  const dependencyErrors = validateDependencyReferences(spec.steps);
  errors.push(...dependencyErrors);

  try {
    buildExecutionLayers(spec.steps);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertValidWorkflowDsl(spec: WorkflowDSL): void {
  const validation = validateWorkflowDsl(spec);
  if (!validation.valid) {
    throw new Error(validation.errors.join('\n'));
  }
}

// ── V2 validation ───────────────────────────────────────────────────────────

export function validateWorkflowDslV2(spec: WorkflowDSLV2): GenerateWorkflowValidation {
  const errors: string[] = [];
  const base = workflowDslV2Schema.safeParse(spec);

  if (!base.success) {
    return {
      valid: false,
      errors: base.error.issues.map((issue) =>
        formatZodIssue(
          issue.path.map((s) => typeof s === 'symbol' ? s.toString() : s),
          issue.message
        )
      ),
    };
  }

  const stepIds = new Set<string>();
  for (const step of spec.steps) {
    if (stepIds.has(step.id)) {
      errors.push(`steps.${step.id}: duplicate step id`);
      continue;
    }
    stepIds.add(step.id);
  }

  // Validate control flow child step references + ownership
  const ownerOf = new Map<string, string>();
  for (const step of spec.steps) {
    const childRefs = getControlFlowChildRefs(step);
    for (const ref of childRefs) {
      if (!stepIds.has(ref)) {
        errors.push(`steps.${step.id}: references unknown step "${ref}"`);
      } else if (ownerOf.has(ref)) {
        errors.push(`steps.${step.id}: step "${ref}" already owned by "${ownerOf.get(ref)}"`);
      } else {
        ownerOf.set(ref, step.id);
      }
    }
  }

  // Validate step inputs for all dedicated runtime-backed step types via step registry
  for (const step of spec.steps) {
    const definition = getStepCompilerDefinition(step.type);
    if (!definition) {
      continue;
    }
    const parsedInput = definition.inputSchema.safeParse(step.input ?? {});
    if (!parsedInput.success) {
      for (const issue of parsedInput.error.issues) {
        errors.push(formatZodIssue(
          ['steps', step.id, 'input', ...issue.path.map(String)],
          issue.message
        ));
      }
    }
  }

  // Validate dependsOn references
  const ownedIds = new Set(ownerOf.keys());
  for (const step of spec.steps) {
    const seenDeps = new Set<string>();
    for (const dep of step.dependsOn ?? []) {
      if (dep === step.id) {
        errors.push(`steps.${step.id}.dependsOn: step cannot depend on itself`);
      }
      if (seenDeps.has(dep)) {
        errors.push(`steps.${step.id}.dependsOn: duplicate dependency "${dep}"`);
      }
      seenDeps.add(dep);
      if (!stepIds.has(dep)) {
        errors.push(`steps.${step.id}.dependsOn: unknown step "${dep}"`);
      } else if (ownedIds.has(dep) && ownerOf.get(dep) !== ownerOf.get(step.id)) {
        // Allow dependsOn between siblings in the same control flow body;
        // block cross-owner references to owned steps.
        errors.push(`steps.${step.id}.dependsOn: "${dep}" is owned by a control flow step and cannot be directly depended on`);
      }
    }
  }

  // Validate step output references (steps.X.output must be in dependsOn)
  const depRefErrors = validateDependencyReferences(spec.steps as WorkflowStep[]);
  errors.push(...depRefErrors);

  // Check for dependency cycles among top-level steps (non-owned)
  const topLevelSteps = spec.steps.filter(s => !ownedIds.has(s.id));
  if (topLevelSteps.length > 0) {
    try {
      buildExecutionLayers(topLevelSteps as WorkflowStep[]);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Unified validation for any DSL version */
export function validateAnyWorkflowDsl(spec: AnyWorkflowDSL): GenerateWorkflowValidation {
  if (spec.version === 'v2') return validateWorkflowDslV2(spec);
  return validateWorkflowDsl(spec as WorkflowDSL);
}

export function isBlankWorkflowDraft(spec: unknown): boolean {
  if (!spec || typeof spec !== 'object') {
    return false;
  }

  const steps = (spec as { steps?: unknown }).steps;
  return !Array.isArray(steps) || steps.length === 0;
}

function getControlFlowBodies(step: WorkflowStep): string[][] {
  const input = step.input as Record<string, unknown> | undefined;
  if (!input) return [];
  if (step.type === 'while' || step.type === 'for-each') {
    const body = input.body;
    return Array.isArray(body) ? [body as string[]] : [];
  }
  if (step.type === 'if-else') {
    const bodies: string[][] = [];
    if (Array.isArray(input.then)) bodies.push(input.then as string[]);
    if (Array.isArray(input.else)) bodies.push(input.else as string[]);
    return bodies;
  }
  return [];
}

function getControlFlowChildRefs(step: WorkflowStep): string[] {
  return getControlFlowBodies(step).flat();
}

// ── Version & Manifest helpers ──────────────────────────────────────────────

export function createWorkflowVersion(spec: AnyWorkflowDSL): string {
  const normalized = stableStringify(spec);
  const prefix = spec.version === 'v2' ? 'dsl-v2' : 'dsl-v1';
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

export function buildCompiledWorkflowManifest(
  spec: Pick<AnyWorkflowDSL, 'name' | 'steps' | 'version'> & { maxDurationMs?: number },
  workflowVersion: string,
  warnings: string[] = []
): CompiledWorkflowManifest {
  const rawMax = (spec as { maxDurationMs?: unknown }).maxDurationMs;
  const maxDurationMs = typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0
    ? rawMax
    : undefined;
  return {
    dslVersion: (spec.version || 'v1') as 'v1' | 'v2',
    artifactKind: 'workflow-factory-module',
    exportedSymbol: 'buildWorkflow',
    workflowName: spec.name,
    workflowVersion,
    stepIds: spec.steps.map((step) => step.id),
    stepTypes: spec.steps.map((step) => step.type as WorkflowStepType),
    stepTimeoutsMs: spec.steps.map((step) => resolveCompiledStepTimeoutMs(step) ?? 0),
    ...(maxDurationMs ? { maxDurationMs } : {}),
    warnings,
  };
}

export function buildExecutionLayers(steps: WorkflowStep[]): WorkflowStep[][] {
  const stepMap = new Map<string, WorkflowStep>();
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const order = new Map<string, number>();

  steps.forEach((step, index) => {
    stepMap.set(step.id, step);
    indegree.set(step.id, step.dependsOn?.length ?? 0);
    order.set(step.id, index);
  });

  steps.forEach((step) => {
    for (const dependency of step.dependsOn ?? []) {
      if (!stepMap.has(dependency)) {
        continue;
      }
      const current = dependents.get(dependency) ?? [];
      current.push(step.id);
      dependents.set(dependency, current);
    }
  });

  const layers: WorkflowStep[][] = [];
  const remaining = new Set(steps.map((step) => step.id));

  while (remaining.size > 0) {
    const nextLayerIds = Array.from(remaining)
      .filter((stepId) => (indegree.get(stepId) ?? 0) === 0)
      .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));

    if (nextLayerIds.length === 0) {
      throw new Error('Workflow DSL contains a dependency cycle');
    }

    layers.push(nextLayerIds.map((stepId) => stepMap.get(stepId)!));

    for (const stepId of nextLayerIds) {
      remaining.delete(stepId);

      for (const dependentId of dependents.get(stepId) ?? []) {
        indegree.set(dependentId, (indegree.get(dependentId) ?? 0) - 1);
      }
    }
  }

  return layers;
}

function validateDependencyReferences(steps: WorkflowStep[]): string[] {
  const errors: string[] = [];
  const stepMap = new Map<string, WorkflowStep>();

  for (const step of steps) {
    stepMap.set(step.id, step);
  }

  // Build implicit dependency sets:
  // - Control flow steps can reference their owned body steps
  // - Body steps can reference prior siblings in the same body (sequential execution order)
  // - Body steps inherit their parent control flow step's transitive dependencies
  const implicitDeps = new Map<string, Set<string>>();
  for (const step of steps) {
    const bodies = getControlFlowBodies(step);
    if (bodies.length === 0) continue;
    // Control flow step itself can reference all its body steps
    const allOwned = new Set(bodies.flat());
    implicitDeps.set(step.id, allOwned);
    // Parent's transitive deps: everything the control flow step can reach
    const parentDeps = collectTransitiveDependencies(step.id, stepMap);
    // Each body step can reference prior siblings + parent's transitive deps
    for (const body of bodies) {
      for (let i = 0; i < body.length; i++) {
        const allowed = implicitDeps.get(body[i]) ?? new Set<string>();
        for (let j = 0; j < i; j++) allowed.add(body[j]);
        for (const dep of parentDeps) allowed.add(dep);
        implicitDeps.set(body[i], allowed);
      }
    }
  }

  for (const step of steps) {
    const references = collectStepOutputReferences(step);
    const allowedDependencies = collectTransitiveDependencies(step.id, stepMap);
    const implicitAllowed = implicitDeps.get(step.id);

    for (const ref of references) {
      if (ref.stepId === step.id) {
        errors.push(`steps.${step.id}: cannot reference its own output`);
        continue;
      }

      if (!stepMap.has(ref.stepId)) {
        errors.push(`${ref.path}: unknown step "${ref.stepId}"`);
        continue;
      }

      if (!allowedDependencies.has(ref.stepId) && !implicitAllowed?.has(ref.stepId)) {
        errors.push(
          `${ref.path}: references steps.${ref.stepId}.output without declaring dependency`
        );
      }
    }
  }

  return errors;
}

function collectTransitiveDependencies(
  stepId: string,
  stepMap: ReadonlyMap<string, WorkflowStep>,
  visiting = new Set<string>()
): Set<string> {
  const result = new Set<string>();
  const step = stepMap.get(stepId);

  if (!step) {
    return result;
  }

  for (const dependency of step.dependsOn ?? []) {
    result.add(dependency);
    if (visiting.has(dependency)) {
      continue;
    }

    visiting.add(dependency);
    for (const nested of collectTransitiveDependencies(dependency, stepMap, visiting)) {
      result.add(nested);
    }
    visiting.delete(dependency);
  }

  return result;
}

function collectStepOutputReferences(
  step: WorkflowStep
): Array<{ stepId: string; path: string }> {
  const refs: Array<{ stepId: string; path: string }> = [];

  collectReferencesFromValue(step.input, [`steps.${step.id}.input`], refs);

  if (step.when) {
    collectReferencesFromCondition(step.when, [`steps.${step.id}.when`], refs);
  }

  return refs;
}

function collectReferencesFromCondition(
  condition: ConditionExpr,
  path: string[],
  refs: Array<{ stepId: string; path: string }>
) {
  if (condition.op === 'exists') {
    validateReferenceSyntax(condition.ref, [...path, 'ref'], refs);
    return;
  }

  if (condition.op === 'and' || condition.op === 'or') {
    for (let i = 0; i < condition.conditions.length; i++) {
      collectReferencesFromCondition(condition.conditions[i], [...path, 'conditions', String(i)], refs);
    }
    return;
  }

  if (condition.op === 'not') {
    collectReferencesFromCondition(condition.condition, [...path, 'condition'], refs);
    return;
  }

  // eq, neq, gt, lt
  validateReferenceSyntax(condition.left, [...path, 'left'], refs);
  collectReferencesFromValue(condition.right, [...path, 'right'], refs);
}

function collectReferencesFromValue(
  value: unknown,
  path: string[],
  refs: Array<{ stepId: string; path: string }>
) {
  if (typeof value === 'string') {
    validateReferenceSyntax(value, path, refs);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectReferencesFromValue(entry, [...path, String(index)], refs);
    });
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    collectReferencesFromValue(entry, [...path, key], refs);
  }
}

function validateReferenceSyntax(
  value: string,
  path: string[],
  refs: Array<{ stepId: string; path: string }>
) {
  if (value === 'input' || value.startsWith('input.')) {
    return;
  }

  const stepRef = STEP_OUTPUT_REF_PATTERN.exec(value);
  if (stepRef) {
    refs.push({
      stepId: stepRef[1],
      path: path.join('.'),
    });
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForHash(value));
}

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortForHash(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortForHash((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

function formatZodIssue(path: Array<string | number>, message: string): string {
  return `${path.map((segment) => String(segment)).join('.') || 'spec'}: ${message}`;
}
