import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

// ── Types ──────────────────────────────────────────────────────────────────

interface DslStep {
  id: string;
  type: string;
  dependsOn?: string[];
  when?: Record<string, unknown>;
  input?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  metadata?: { position?: { x: number; y: number }; label?: string };
}

interface DslSpec {
  version: string;
  name: string;
  description?: string;
  steps: DslStep[];
}

export interface StepNodeData {
  stepId: string;
  stepType: string;
  label: string;
  input: Record<string, unknown>;
  dependsOn: string[];
  policy?: { timeoutMs?: number; retry?: { maximumAttempts?: number } };
  [key: string]: unknown;
}

// ── Constants ──────────────────────────────────────────────────────────────

const NODE_WIDTH = 190;
const NODE_HEIGHT = 60;

const DEDICATED_NODE_TYPES = new Set(['agent', 'if-else', 'for-each', 'while', 'wait', 'notification', 'capability']);
const STEP_OUTPUT_REF_PATTERN = /^steps\.([A-Za-z0-9_-]+)\.output(?:\.(.+))?$/;

// ── DSL → Graph ────────────────────────────────────────────────────────────

export function dslToGraph(
  spec: DslSpec,
  presetNames: Record<string, string> = {},
): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  const nodes: Node<StepNodeData>[] = spec.steps.map(step => ({
    id: step.id,
    type: stepTypeToNodeType(step.type),
    position: step.metadata?.position ?? { x: 0, y: 0 },
    data: {
      stepId: step.id,
      stepType: step.type,
      label: getStepLabel(step, presetNames),
      input: step.input ?? {},
      dependsOn: step.dependsOn ?? [],
      ...(step.policy ? { policy: step.policy as StepNodeData['policy'] } : {}),
    },
  }));

  const edges: Edge[] = [];
  for (const step of spec.steps) {
    // dependsOn edges
    for (const dep of step.dependsOn ?? []) {
      edges.push({
        id: `dep-${dep}-${step.id}`,
        source: dep,
        target: step.id,
        type: 'default',
      });
    }
    // Control flow body edges
    const bodyEdges = buildControlFlowEdges(step);
    edges.push(...bodyEdges);
  }

  // Apply dagre layout if any node is missing a saved position
  const allHavePositions = spec.steps.every(s => s.metadata?.position);
  if (!allHavePositions) {
    applyDagreLayout(nodes, edges);
  }

  return { nodes, edges };
}

// ── Graph → DSL ────────────────────────────────────────────────────────────

export function graphToDsl(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
  baseDsl: DslSpec,
): DslSpec {
  const originalStepMap = new Map(baseDsl.steps.map(s => [s.id, s]));

  const steps: DslStep[] = nodes.map(node => {
    const d = node.data;
    const original = originalStepMap.get(d.stepId);

    // Rebuild dependsOn from dep-* edges targeting this node
    const deps = edges
      .filter(e => e.target === node.id && e.id.startsWith('dep-'))
      .map(e => e.source);

    return {
      id: d.stepId,
      type: d.stepType,
      ...(deps.length > 0 ? { dependsOn: deps } : {}),
      ...(original?.when ? { when: original.when } : {}),
      input: d.input,
      ...(d.policy ? { policy: d.policy } : original?.policy ? { policy: original.policy } : {}),
      metadata: { position: { x: node.position.x, y: node.position.y } },
    };
  });

  return sanitizeDslStepReferences({ ...baseDsl, steps });
}

export function removeStepFromDsl(
  spec: DslSpec,
  stepId: string,
): DslSpec {
  return sanitizeDslStepReferences({
    ...spec,
    steps: spec.steps.filter((step) => step.id !== stepId),
  });
}

export function sanitizeDslStepReferences(spec: DslSpec): DslSpec {
  const validStepIds = new Set(spec.steps.map((step) => step.id));

  return {
    ...spec,
    steps: spec.steps.map((step) => {
      const nextDependsOn = (step.dependsOn ?? []).filter((dep) => dep !== step.id && validStepIds.has(dep));
      const sanitizedInput = sanitizeGenericStepRefs(step.input, validStepIds);
      const nextInput = sanitizeControlFlowInputRefs({
        ...step,
        input: sanitizedInput,
      }, validStepIds);
      const nextWhen = containsMissingStepReference(step.when, validStepIds)
        ? undefined
        : step.when;

      return {
        ...step,
        ...(nextDependsOn.length > 0 ? { dependsOn: nextDependsOn } : {}),
        ...(nextDependsOn.length === 0 && step.dependsOn ? { dependsOn: undefined } : {}),
        ...(nextWhen ? { when: nextWhen } : step.when ? { when: undefined } : {}),
        ...(nextInput ? { input: nextInput } : step.input ? { input: undefined } : {}),
      };
    }),
  };
}

// ── Dagre auto-layout ──────────────────────────────────────────────────────

function applyDagreLayout(nodes: Node[], edges: Edge[]): void {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  for (const node of nodes) {
    const pos = g.node(node.id);
    if (pos) {
      node.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function stepTypeToNodeType(type: string): string {
  if (DEDICATED_NODE_TYPES.has(type)) return type;
  return 'agent';
}

function getStepLabel(step: DslStep, presetNames: Record<string, string>): string {
  if (step.type === 'agent') {
    const preset = step.input?.preset;
    return typeof preset === 'string' ? (presetNames[preset] || preset) : step.id;
  }
  if (step.type === 'if-else') return 'IF / ELSE';
  if (step.type === 'for-each') return 'FOR EACH';
  if (step.type === 'while') return 'WHILE';
  if (step.type === 'wait') return '等待';
  if (step.type === 'notification') return '通知';
  if (step.type === 'capability') {
    const capId = step.input?.capabilityId;
    return typeof capId === 'string' ? capId : '能力';
  }
  return step.id;
}

function buildControlFlowEdges(step: DslStep): Edge[] {
  const input = step.input as Record<string, unknown> | undefined;
  if (!input) return [];
  const edges: Edge[] = [];

  if (step.type === 'if-else') {
    for (const id of (input.then as string[]) ?? []) {
      edges.push({ id: `then-${step.id}-${id}`, source: step.id, target: id, label: 'then', style: { strokeDasharray: '5 3' } });
    }
    for (const id of (input.else as string[] | undefined) ?? []) {
      edges.push({ id: `else-${step.id}-${id}`, source: step.id, target: id, label: 'else', style: { strokeDasharray: '5 3' } });
    }
  } else if (step.type === 'for-each' || step.type === 'while') {
    for (const id of (input.body as string[]) ?? []) {
      edges.push({ id: `body-${step.id}-${id}`, source: step.id, target: id, label: 'body', style: { strokeDasharray: '5 3' } });
    }
  }

  return edges;
}

function sanitizeControlFlowInputRefs(
  step: DslStep,
  validStepIds: Set<string>,
): DslStep['input'] {
  if (!step.input) {
    return step.input;
  }

  if (step.type === 'if-else') {
    const thenRefs = pruneStepIdArray(step.input.then, validStepIds);
    const elseRefs = pruneStepIdArray(step.input.else, validStepIds);

    return {
      ...step.input,
      then: thenRefs,
      ...(elseRefs.length > 0 ? { else: elseRefs } : {}),
      ...(elseRefs.length === 0 && 'else' in step.input ? { else: undefined } : {}),
    };
  }

  if (step.type === 'for-each' || step.type === 'while') {
    return {
      ...step.input,
      body: pruneStepIdArray(step.input.body, validStepIds),
    };
  }

  return step.input;
}

function sanitizeGenericStepRefs(
  value: Record<string, unknown> | undefined,
  validStepIds: Set<string>,
): Record<string, unknown> | undefined {
  const sanitized = sanitizeUnknownValue(value, validStepIds);
  if (!sanitized || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    return undefined;
  }
  return sanitized as Record<string, unknown>;
}

function sanitizeUnknownValue(
  value: unknown,
  validStepIds: Set<string>,
): unknown {
  if (typeof value === 'string') {
    const match = STEP_OUTPUT_REF_PATTERN.exec(value);
    if (match && !validStepIds.has(match[1])) {
      return undefined;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeUnknownValue(entry, validStepIds))
      .filter((entry) => entry !== undefined);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce<Record<string, unknown>>((result, [key, entry]) => {
    const sanitized = sanitizeUnknownValue(entry, validStepIds);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
    return result;
  }, {});
}

function containsMissingStepReference(
  value: unknown,
  validStepIds: Set<string>,
): boolean {
  if (typeof value === 'string') {
    const match = STEP_OUTPUT_REF_PATTERN.exec(value);
    return Boolean(match && !validStepIds.has(match[1]));
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsMissingStepReference(entry, validStepIds));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).some((entry) => containsMissingStepReference(entry, validStepIds));
}

function pruneStepIdArray(value: unknown, validStepIds: Set<string>): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && validStepIds.has(entry));
}
