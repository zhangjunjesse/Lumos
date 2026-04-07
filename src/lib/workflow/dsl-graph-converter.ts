import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import { sanitizeDslStepReferences } from './dsl-sanitize';

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
  isContainer?: boolean;
  policy?: { timeoutMs?: number; retry?: { maximumAttempts?: number } };
  [key: string]: unknown;
}

// ── Constants ──────────────────────────────────────────────────────────────

const NODE_W = 190;
const NODE_H = 60;
const HEADER_H = 46;
const BODY_H = 56;
const BODY_GAP = 8;
const BODY_PAD_X = 10;
const BODY_PAD_B = 12;

const DEDICATED = new Set(['agent', 'if-else', 'for-each', 'while', 'wait', 'notification', 'capability']);
const CONTAINERS = new Set(['if-else', 'for-each', 'while']);

// ── Helpers ────────────────────────────────────────────────────────────────

function getBodyIds(step: DslStep): string[] {
  if (!step.input) return [];
  return [
    ...((step.input.body as string[] | undefined) ?? []),
    ...((step.input.then as string[] | undefined) ?? []),
    ...((step.input.else as string[] | undefined) ?? []),
  ];
}

function buildBodyMap(steps: DslStep[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of steps) {
    if (!CONTAINERS.has(s.type)) continue;
    for (const id of getBodyIds(s)) m.set(id, s.id);
  }
  return m;
}

function containerDims(n: number): { w: number; h: number } {
  return { w: NODE_W + BODY_PAD_X * 2, h: HEADER_H + n * (BODY_H + BODY_GAP) - BODY_GAP + BODY_PAD_B };
}

export function stepTypeToNodeType(t: string): string {
  return DEDICATED.has(t) ? t : 'agent';
}

function stepLabel(step: DslStep, names: Record<string, string>): string {
  if (step.type === 'agent') {
    const p = step.input?.preset;
    return typeof p === 'string' ? (names[p] || p) : step.id;
  }
  if (step.type === 'while') {
    return step.input?.mode === 'do-while' ? 'DO-WHILE' : 'WHILE';
  }
  const m: Record<string, string> = {
    'if-else': 'IF / ELSE', 'for-each': 'FOR EACH', wait: '等待', notification: '通知',
  };
  if (m[step.type]) return m[step.type];
  if (step.type === 'capability') {
    const c = step.input?.capabilityId;
    return typeof c === 'string' ? c : '能力';
  }
  return step.id;
}

// ── DSL → Graph ────────────────────────────────────────────────────────────

export function dslToGraph(
  spec: DslSpec,
  presetNames: Record<string, string> = {},
): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  const bodyMap = buildBodyMap(spec.steps);
  const stepMap = new Map(spec.steps.map(s => [s.id, s]));
  const nodes: Node<StepNodeData>[] = [];
  const edges: Edge[] = [];

  for (const step of spec.steps) {
    const parentId = bodyMap.get(step.id);
    const isCont = CONTAINERS.has(step.type);
    const bodyIds = isCont ? getBodyIds(step).filter(id => stepMap.has(id)) : [];
    const dims = isCont && bodyIds.length > 0 ? containerDims(bodyIds.length) : null;

    nodes.push({
      id: step.id,
      type: stepTypeToNodeType(step.type),
      position: step.metadata?.position ?? (parentId ? { x: BODY_PAD_X, y: HEADER_H } : { x: 0, y: 0 }),
      ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      ...(dims ? { style: { width: dims.w, height: dims.h } } : {}),
      data: {
        stepId: step.id, stepType: step.type,
        label: stepLabel(step, presetNames),
        input: step.input ?? {}, dependsOn: step.dependsOn ?? [],
        isContainer: isCont && bodyIds.length > 0,
        ...(step.policy ? { policy: step.policy as StepNodeData['policy'] } : {}),
      },
    });

    for (const dep of step.dependsOn ?? []) {
      edges.push({ id: `dep-${dep}-${step.id}`, source: dep, target: step.id });
    }
  }

  // Auto-layout when positions are missing
  if (!spec.steps.every(s => s.metadata?.position)) {
    const topNodes = nodes.filter(n => !n.parentId);
    const topNodeIds = new Set(topNodes.map(n => n.id));
    const topEdges = edges.filter(e => topNodeIds.has(e.source) && topNodeIds.has(e.target));
    applyDagreLayout(topNodes, topEdges);

    // Position body steps inside their containers
    for (const step of spec.steps) {
      if (!CONTAINERS.has(step.type)) continue;
      const ids = getBodyIds(step).filter(id => stepMap.has(id));
      ids.forEach((id, i) => {
        const n = nodes.find(nd => nd.id === id);
        if (n) n.position = { x: BODY_PAD_X, y: HEADER_H + i * (BODY_H + BODY_GAP) };
      });
    }
  }

  return { nodes, edges };
}

// ── Graph → DSL ────────────────────────────────────────────────────────────

export function graphToDsl(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
  baseDsl: DslSpec,
): DslSpec {
  const origMap = new Map(baseDsl.steps.map(s => [s.id, s]));
  const kidsByParent = new Map<string, Node<StepNodeData>[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const arr = kidsByParent.get(n.parentId) ?? [];
    arr.push(n as Node<StepNodeData>);
    kidsByParent.set(n.parentId, arr);
  }

  const steps = nodes.map(node => {
    const d = node.data;
    const orig = origMap.get(d.stepId);
    const deps = edges.filter(e => e.target === node.id && e.id.startsWith('dep-')).map(e => e.source);

    let input = d.input;
    if (CONTAINERS.has(d.stepType) && kidsByParent.has(node.id)) {
      const kids = kidsByParent.get(node.id)!.slice().sort((a, b) => a.position.y - b.position.y);
      const kidIds = kids.map(k => (k as Node<StepNodeData>).data.stepId);
      if (d.stepType === 'while' || d.stepType === 'for-each') {
        input = { ...input, body: kidIds };
      } else if (d.stepType === 'if-else') {
        const thenSet = new Set((orig?.input?.then as string[] | undefined) ?? []);
        input = { ...input, then: kidIds.filter(id => thenSet.has(id)), else: kidIds.filter(id => !thenSet.has(id)) };
      }
    }

    return {
      id: d.stepId, type: d.stepType,
      ...(deps.length > 0 ? { dependsOn: deps } : {}),
      ...(orig?.when ? { when: orig.when } : {}),
      input,
      ...(d.policy ? { policy: d.policy } : orig?.policy ? { policy: orig.policy } : {}),
      metadata: { position: { x: node.position.x, y: node.position.y } },
    };
  });

  return sanitizeDslStepReferences({ ...baseDsl, steps });
}

export function removeStepFromDsl(spec: DslSpec, stepId: string): DslSpec {
  return sanitizeDslStepReferences({ ...spec, steps: spec.steps.filter(s => s.id !== stepId) });
}

// ── Dagre auto-layout ──────────────────────────────────────────────────────

function applyDagreLayout(nodes: Node[], edges: Edge[]): void {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 });
  for (const n of nodes) {
    const w = (n.style?.width as number | undefined) ?? NODE_W;
    const h = (n.style?.height as number | undefined) ?? NODE_H;
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  for (const n of nodes) {
    const pos = g.node(n.id);
    const w = (n.style?.width as number | undefined) ?? NODE_W;
    const h = (n.style?.height as number | undefined) ?? NODE_H;
    if (pos) n.position = { x: pos.x - w / 2, y: pos.y - h / 2 };
  }
}

export { sanitizeDslStepReferences } from './dsl-sanitize';
