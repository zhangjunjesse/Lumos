import { createHash } from 'crypto';
import { z } from 'zod';
import { getStepCompilerDefinition } from './step-registry';
import type {
  CompiledWorkflowManifest,
  ConditionExpr,
  GenerateWorkflowValidation,
  WorkflowDSL,
  WorkflowStep,
  WorkflowStepType,
} from './types';

const workflowStepPolicySchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  retry: z.object({
    maximumAttempts: z.number().int().positive().optional(),
  }).strict().optional(),
}).strict().optional();

const conditionExprSchema: z.ZodType<ConditionExpr> = z.union([
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

const workflowStepSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['agent', 'browser', 'notification', 'capability']),
  dependsOn: z.array(z.string().min(1)).optional(),
  when: conditionExprSchema.optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  policy: workflowStepPolicySchema,
}).strict();

const workflowDslSchema: z.ZodType<WorkflowDSL> = z.object({
  version: z.literal('v1'),
  name: z.string().min(1),
  steps: z.array(workflowStepSchema).min(1).max(20),
}).strict();

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

export function createWorkflowVersion(spec: WorkflowDSL): string {
  const normalized = stableStringify(spec);
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `dsl-v1-${hash}`;
}

export function buildCompiledWorkflowManifest(
  spec: Pick<WorkflowDSL, 'name' | 'steps'>,
  workflowVersion: string,
  warnings: string[] = []
): CompiledWorkflowManifest {
  return {
    dslVersion: 'v1',
    artifactKind: 'workflow-factory-module',
    exportedSymbol: 'buildWorkflow',
    workflowName: spec.name,
    workflowVersion,
    stepIds: spec.steps.map((step) => step.id),
    stepTypes: spec.steps.map((step) => step.type as WorkflowStepType),
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

  for (const step of steps) {
    const references = collectStepOutputReferences(step);
    const allowedDependencies = collectTransitiveDependencies(step.id, stepMap);

    for (const ref of references) {
      if (ref.stepId === step.id) {
        errors.push(`steps.${step.id}: cannot reference its own output`);
        continue;
      }

      if (!stepMap.has(ref.stepId)) {
        errors.push(`${ref.path}: unknown step "${ref.stepId}"`);
        continue;
      }

      if (!allowedDependencies.has(ref.stepId)) {
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
