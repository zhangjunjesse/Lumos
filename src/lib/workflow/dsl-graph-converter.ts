import type { Node, Edge } from '@xyflow/react';
import { sanitizeDslStepReferences } from './dsl-sanitize';
import { buildEdges } from './dsl-graph-edges';
import {
  layoutStep,
  layoutSubDag,
  isContainer,
  getThenIds,
  buildParentMap,
  hasNestedContainers,
  CONT_HEADER_H,
  CONT_PAD_X,
  BRANCH_LABEL_H,
  BRANCH_GAP,
  type LayoutStep,
  type StepLayout,
} from './dsl-graph-layout';

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
  /** for if-else children: which branch they belong to */
  branch?: 'then' | 'else';
  /** for if-else containers: px height of the THEN region — used to place ELSE banner */
  thenBlockH?: number;
  /** transient UI flag set by the canvas while a drag is hovering this container */
  isDropTarget?: boolean;
  [key: string]: unknown;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEDICATED = new Set([
  'agent', 'if-else', 'for-each', 'while', 'wait', 'notification', 'capability',
]);
const CONTAINER_TYPES = new Set(['if-else', 'for-each', 'while']);

export function stepTypeToNodeType(t: string): string {
  return DEDICATED.has(t) ? t : 'agent';
}

function toLayoutStep(s: DslStep): LayoutStep {
  return { id: s.id, type: s.type, dependsOn: s.dependsOn, input: s.input };
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

// ── Position computation ───────────────────────────────────────────────────

function computePositions(
  spec: DslSpec,
  layoutSteps: LayoutStep[],
  stepMap: Map<string, LayoutStep>,
  parentMap: Map<string, string>,
  sizes: Map<string, StepLayout>,
): Map<string, { x: number; y: number }> {
  // Preserve manual positions only for pure flat workflows (no containers at all).
  // When any container exists, children's positions depend on body order, so we
  // must re-layout to keep things in sync.
  const hasAnyContainer = layoutSteps.some(isContainer);
  const canPreserve = !hasAnyContainer && spec.steps.every(s => s.metadata?.position);
  const positions = new Map<string, { x: number; y: number }>();

  if (canPreserve) {
    for (const s of spec.steps) positions.set(s.id, s.metadata!.position!);
    return positions;
  }

  const topIds = spec.steps.filter(s => !parentMap.get(s.id)).map(s => s.id);
  layoutSubDag(topIds, stepMap).positions.forEach((p, id) => positions.set(id, p));

  for (const s of layoutSteps) {
    if (!isContainer(s)) continue;
    const sz = sizes.get(s.id)!;
    if (s.type === 'if-else') {
      if (sz.thenLayout) {
        const dy = CONT_HEADER_H + BRANCH_LABEL_H;
        sz.thenLayout.positions.forEach((p, id) => {
          positions.set(id, { x: p.x + CONT_PAD_X, y: p.y + dy });
        });
      }
      if (sz.elseLayout) {
        const dy = CONT_HEADER_H + BRANCH_LABEL_H + (sz.thenLayout?.h ?? 0) + BRANCH_GAP + BRANCH_LABEL_H;
        sz.elseLayout.positions.forEach((p, id) => {
          positions.set(id, { x: p.x + CONT_PAD_X, y: p.y + dy });
        });
      }
    } else if (sz.innerLayout) {
      sz.innerLayout.positions.forEach((p, id) => {
        positions.set(id, { x: p.x + CONT_PAD_X, y: p.y + CONT_HEADER_H });
      });
    }
  }
  return positions;
}

// ── Node building ──────────────────────────────────────────────────────────

function buildNode(
  step: DslStep,
  stepMap: Map<string, LayoutStep>,
  parentMap: Map<string, string>,
  sizes: Map<string, StepLayout>,
  positions: Map<string, { x: number; y: number }>,
  presetNames: Record<string, string>,
): Node<StepNodeData> {
  const layoutS = stepMap.get(step.id)!;
  const parentId = parentMap.get(step.id);
  const cont = isContainer(layoutS);
  const sz = sizes.get(step.id)!;

  let branch: 'then' | 'else' | undefined;
  if (parentId) {
    const parent = stepMap.get(parentId);
    if (parent?.type === 'if-else') {
      branch = new Set(getThenIds(parent)).has(step.id) ? 'then' : 'else';
    }
  }

  return {
    id: step.id,
    type: stepTypeToNodeType(step.type),
    position: positions.get(step.id) ?? { x: 0, y: 0 },
    ...(parentId ? { parentId, extent: 'parent' as const } : {}),
    ...(cont ? { style: { width: sz.w, height: sz.h } } : {}),
    data: {
      stepId: step.id,
      stepType: step.type,
      label: stepLabel(step, presetNames),
      input: step.input ?? {},
      dependsOn: step.dependsOn ?? [],
      isContainer: cont,
      ...(branch ? { branch } : {}),
      ...(step.type === 'if-else' && sz.thenLayout ? { thenBlockH: sz.thenLayout.h } : {}),
      ...(step.policy ? { policy: step.policy as StepNodeData['policy'] } : {}),
    },
  };
}

// ── DSL → Graph ────────────────────────────────────────────────────────────

export function dslToGraph(
  spec: DslSpec,
  presetNames: Record<string, string> = {},
): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  void hasNestedContainers; // kept as exported utility
  const layoutSteps = spec.steps.map(toLayoutStep);
  const stepMap = new Map(layoutSteps.map(s => [s.id, s]));
  const parentMap = buildParentMap(layoutSteps);
  const sizes = new Map(layoutSteps.map(s => [s.id, layoutStep(s, stepMap)]));
  const positions = computePositions(spec, layoutSteps, stepMap, parentMap, sizes);

  const nodes = spec.steps.map(s => buildNode(s, stepMap, parentMap, sizes, positions, presetNames));
  const edges = buildEdges(spec.steps, layoutSteps, parentMap);

  return { nodes, edges };
}

// ── Graph → DSL ────────────────────────────────────────────────────────────

function sortKids(kids: Node<StepNodeData>[]): Node<StepNodeData>[] {
  return kids.slice().sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x));
}

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
    arr.push(n);
    kidsByParent.set(n.parentId, arr);
  }

  const steps = nodes.map(node => {
    const d = node.data;
    const orig = origMap.get(d.stepId);
    const deps = edges.filter(e => e.target === node.id && e.id.startsWith('dep-')).map(e => e.source);

    let input = d.input;
    if (CONTAINER_TYPES.has(d.stepType) && kidsByParent.has(node.id)) {
      const kids = kidsByParent.get(node.id)!;
      if (d.stepType === 'while' || d.stepType === 'for-each') {
        input = { ...input, body: sortKids(kids).map(k => k.data.stepId) };
      } else if (d.stepType === 'if-else') {
        const origThen = new Set((orig?.input?.then as string[] | undefined) ?? []);
        const thenKids: Node<StepNodeData>[] = [];
        const elseKids: Node<StepNodeData>[] = [];
        for (const k of kids) {
          const b = k.data.branch ?? (origThen.has(k.data.stepId) ? 'then' : 'else');
          (b === 'then' ? thenKids : elseKids).push(k);
        }
        input = {
          ...input,
          then: sortKids(thenKids).map(k => k.data.stepId),
          else: sortKids(elseKids).map(k => k.data.stepId),
        };
      }
    }

    return {
      id: d.stepId,
      type: d.stepType,
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

export { sanitizeDslStepReferences } from './dsl-sanitize';
