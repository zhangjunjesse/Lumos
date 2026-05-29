import { createHash } from 'crypto';
import { resolveCompiledStepTimeoutMs } from './compiler-helpers';
import { validateDsl as validateDslV3 } from './validate-dsl-v3';
import type {
  AnyWorkflowDSL,
  CompiledWorkflowManifest,
  GenerateWorkflowValidation,
  WorkflowStep,
  WorkflowStepType,
} from './types';

/** Unified validation entry: delegates to V3 structural + schema checks. */
export function validateAnyWorkflowDsl(spec: AnyWorkflowDSL): GenerateWorkflowValidation {
  if (spec.version === 'v3') {
    const report = validateDslV3(spec);
    if (report.valid) return { valid: true, errors: [] };
    const errors = report.issues
      .filter((i) => i.severity === 'error')
      .map((i) => `${i.jsonPath || 'spec'}: ${i.message}`);
    return { valid: false, errors };
  }
  return {
    valid: false,
    errors: [`unsupported DSL version: ${(spec as { version?: unknown }).version ?? 'unknown'}`],
  };
}

export function isBlankWorkflowDraft(spec: unknown): boolean {
  if (!spec || typeof spec !== 'object') return false;
  const nodes = (spec as { nodes?: unknown }).nodes;
  return !Array.isArray(nodes) || nodes.length === 0;
}

export function createWorkflowVersion(spec: AnyWorkflowDSL): string {
  const normalized = stableStringify(spec);
  const prefix = `dsl-${spec.version}`;
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

export function buildCompiledWorkflowManifest(
  spec: AnyWorkflowDSL,
  workflowVersion: string,
  warnings: string[] = []
): CompiledWorkflowManifest {
  const maxDurationMs = typeof spec.maxDurationMs === 'number' && Number.isFinite(spec.maxDurationMs) && spec.maxDurationMs > 0
    ? spec.maxDurationMs
    : undefined;

  // This runs on the INVALID-spec path too (compiler.ts returns a manifest
  // alongside validation errors), so `nodes` may be missing/malformed — e.g. a
  // stale v1 spec carrying `steps` instead of `nodes`. Never assume it's an
  // array, or `.map` throws "Cannot read properties of undefined" and the clean
  // validation error never reaches the caller.
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];

  return {
    dslVersion: 'v3',
    artifactKind: 'workflow-factory-module',
    exportedSymbol: 'buildWorkflow',
    workflowName: spec.name,
    workflowVersion,
    stepIds: nodes.map((n) => n.id),
    stepTypes: nodes.map((n) => n.type),
    stepTimeoutsMs: nodes.map((n) => {
      const step: WorkflowStep = {
        id: n.id,
        type: n.type as WorkflowStepType,
        input: (n as { input?: Record<string, unknown> }).input,
        policy: n.policy,
      };
      return resolveCompiledStepTimeoutMs(step) ?? 0;
    }),
    ...(maxDurationMs ? { maxDurationMs } : {}),
    warnings,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForHash(value));
}

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortForHash(entry));
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortForHash((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}
