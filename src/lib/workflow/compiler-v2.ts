import {
  buildCompiledWorkflowManifest,
  createWorkflowVersion,
} from './dsl';
import {
  emitLiteral,
  emitRuntimeHelpers,
  resultBindingName,
} from './compiler-helpers';
import { emitStep } from './compiler-v2-emitters';
import type { GenerateWorkflowResult, WorkflowDSLV2, WorkflowStep } from './types';

/**
 * Compile a v2 DSL (with control flow) into executable JS module code.
 *
 * Strategy:
 *  1. Identify "owned" steps (body/then/else children of control flow steps)
 *  2. Top-level steps go through layer-based scheduling (like v1)
 *  3. Control flow steps emit JS control structures with body steps inline
 */
export function compileWorkflowDslV2(spec: WorkflowDSLV2): GenerateWorkflowResult {
  const ownedStepIds = collectOwnedStepIds(spec.steps);
  const topLevelSteps = spec.steps.filter(s => !ownedStepIds.has(s.id));
  const stepMap = new Map(spec.steps.map(s => [s.id, s]));

  const layers = buildTopLevelLayers(topLevelSteps);
  const bodyLines = layers
    .map(layer => emitLayer(layer, stepMap, ownedStepIds))
    .join('\n\n');

  const version = createWorkflowVersion(spec);
  const code = wrapModule(spec.name, version, bodyLines);
  const manifest = buildCompiledWorkflowManifest(spec, version);

  return { code, manifest, validation: { valid: true, errors: [] } };
}

// ── Owned step collection ──────────────────────────────────────────────────

function collectOwnedStepIds(steps: WorkflowStep[]): Set<string> {
  const owned = new Set<string>();
  for (const step of steps) {
    const input = step.input as Record<string, unknown> | undefined;
    if (!input) continue;
    if (step.type === 'if-else') {
      for (const id of (input.then as string[]) ?? []) owned.add(id);
      for (const id of (input.else as string[] | undefined) ?? []) owned.add(id);
    } else if (step.type === 'for-each' || step.type === 'while') {
      for (const id of (input.body as string[]) ?? []) owned.add(id);
    }
  }
  return owned;
}

// ── Topological sort of top-level steps ────────────────────────────────────

function buildTopLevelLayers(steps: WorkflowStep[]): WorkflowStep[][] {
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const order = new Map<string, number>();

  steps.forEach((s, i) => {
    indegree.set(s.id, (s.dependsOn ?? []).filter(d => stepMap.has(d)).length);
    order.set(s.id, i);
  });
  steps.forEach(s => {
    for (const dep of (s.dependsOn ?? []).filter(d => stepMap.has(d))) {
      const list = dependents.get(dep) ?? [];
      list.push(s.id);
      dependents.set(dep, list);
    }
  });

  const layers: WorkflowStep[][] = [];
  const remaining = new Set(steps.map(s => s.id));

  while (remaining.size > 0) {
    const ready = Array.from(remaining)
      .filter(id => (indegree.get(id) ?? 0) === 0)
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    if (ready.length === 0) throw new Error('Dependency cycle in top-level steps');
    layers.push(ready.map(id => stepMap.get(id)!));
    for (const id of ready) {
      remaining.delete(id);
      for (const dep of dependents.get(id) ?? []) {
        indegree.set(dep, (indegree.get(dep) ?? 0) - 1);
      }
    }
  }
  return layers;
}

// ── Layer emission ─────────────────────────────────────────────────────────

function emitLayer(
  layer: WorkflowStep[],
  stepMap: Map<string, WorkflowStep>,
  ownedStepIds: Set<string>,
): string {
  if (layer.length === 1) return emitStep(layer[0], stepMap, ownedStepIds, 6);
  return emitParallelLayer(layer, stepMap, ownedStepIds);
}

function emitParallelLayer(
  layer: WorkflowStep[],
  stepMap: Map<string, WorkflowStep>,
  ownedStepIds: Set<string>,
): string {
  const bindings = layer.map(s => resultBindingName(s.id));
  const promises = layer.map(s => {
    const inner = emitStep(s, stepMap, ownedStepIds, 10);
    return [
      '        (async () => {',
      inner,
      `          return stepOutputs[${emitLiteral(s.id)}];`,
      '        })()',
    ].join('\n');
  }).join(',\n');

  const assignments = layer.map((s, i) =>
    `      stepOutputs[${emitLiteral(s.id)}] = ${bindings[i]};`,
  ).join('\n');

  return [
    `      const [${bindings.join(', ')}] = await Promise.all([`,
    promises,
    '      ]);',
    assignments,
  ].join('\n');
}

// ── Module wrapper ─────────────────────────────────────────────────────────

function wrapModule(name: string, version: string, body: string): string {
  const helpers = emitRuntimeHelpers();
  return [
    "import { defineWorkflow } from 'openworkflow';",
    '',
    ...helpers,
    '',
    'export function buildWorkflow(runtime) {',
    '  const { agentStep, onStepStarted, onStepCompleted, onStepSkipped } = runtime;',
    '',
    '  return defineWorkflow(',
    `    { name: ${emitLiteral(name)}, version: ${emitLiteral(version)} },`,
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
