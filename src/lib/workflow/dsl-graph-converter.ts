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

  // Apply dagre layout if no meaningful positions saved
  // Treat all-zero positions as "no layout" (e.g. legacy data)
  const hasDistinctPositions = spec.steps.some(s => {
    const p = s.metadata?.position;
    return p && (p.x !== 0 || p.y !== 0);
  });
  if (!hasDistinctPositions) {
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

  return { ...baseDsl, steps };
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
