import dagre from 'dagre';

// ── Layout constants ───────────────────────────────────────────────────────

export const NODE_W = 180;
export const NODE_H = 52;
export const CONT_HEADER_H = 48;
export const CONT_PAD_X = 16;
export const CONT_PAD_BOTTOM = 14;
export const GAP_X = 60;
export const GAP_Y = 24;
export const BRANCH_LABEL_H = 20;
export const BRANCH_GAP = 20;

// ── Types ──────────────────────────────────────────────────────────────────

export interface LayoutStep {
  id: string;
  type: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
}

export interface NodeSize { w: number; h: number }
export interface NodePos { x: number; y: number }
export interface DagLayout {
  w: number;
  h: number;
  positions: Map<string, NodePos>;
  sizes: Map<string, NodeSize>;
}
export interface StepLayout extends NodeSize {
  innerLayout?: DagLayout;
  thenLayout?: DagLayout;
  elseLayout?: DagLayout;
}

const CONTAINERS = new Set(['if-else', 'for-each', 'while']);

// ── Body accessors ─────────────────────────────────────────────────────────

export function getBodyIds(step: LayoutStep): string[] {
  if (!step.input) return [];
  return [
    ...((step.input.body as string[] | undefined) ?? []),
    ...((step.input.then as string[] | undefined) ?? []),
    ...((step.input.else as string[] | undefined) ?? []),
  ];
}

export function getThenIds(step: LayoutStep): string[] {
  return (step.input?.then as string[] | undefined) ?? [];
}
export function getElseIds(step: LayoutStep): string[] {
  return (step.input?.else as string[] | undefined) ?? [];
}
export function getLoopBodyIds(step: LayoutStep): string[] {
  return (step.input?.body as string[] | undefined) ?? [];
}

export function isContainer(step: LayoutStep): boolean {
  return CONTAINERS.has(step.type);
}

// ── Recursive layout ───────────────────────────────────────────────────────

/**
 * Compute the rendered size of one step. Containers size themselves based on
 * their children (recursive), non-containers use a fixed compact card size.
 */
export function layoutStep(
  step: LayoutStep,
  stepMap: Map<string, LayoutStep>,
): StepLayout {
  if (!isContainer(step)) return { w: NODE_W, h: NODE_H };

  if (step.type === 'if-else') {
    const thenLayout = layoutSubDag(getThenIds(step), stepMap);
    const elseLayout = layoutSubDag(getElseIds(step), stepMap);
    const innerW = Math.max(thenLayout.w, elseLayout.w, NODE_W);
    const hasElse = getElseIds(step).length > 0;
    const innerH =
      BRANCH_LABEL_H + thenLayout.h +
      (hasElse ? BRANCH_GAP + BRANCH_LABEL_H + elseLayout.h : 0);
    return {
      w: innerW + CONT_PAD_X * 2,
      h: CONT_HEADER_H + innerH + CONT_PAD_BOTTOM,
      thenLayout,
      elseLayout,
    };
  }

  const innerLayout = layoutSubDag(getLoopBodyIds(step), stepMap);
  return {
    w: innerLayout.w + CONT_PAD_X * 2,
    h: CONT_HEADER_H + innerLayout.h + CONT_PAD_BOTTOM,
    innerLayout,
  };
}

/**
 * Lay out a set of sibling steps as a horizontal DAG (dagre LR).
 * Each child is sized recursively so a deeply-nested container gets the real
 * bounding box it needs before participating in this layer's layout.
 * Positions in the returned `positions` map are normalized to start at (0, 0).
 */
export function layoutSubDag(
  stepIds: string[],
  stepMap: Map<string, LayoutStep>,
): DagLayout {
  const steps = stepIds.map(id => stepMap.get(id)).filter((s): s is LayoutStep => Boolean(s));
  if (steps.length === 0) {
    return { w: NODE_W, h: NODE_H, positions: new Map(), sizes: new Map() };
  }

  const sizes = new Map<string, NodeSize>();
  for (const s of steps) {
    const sz = layoutStep(s, stepMap);
    sizes.set(s.id, { w: sz.w, h: sz.h });
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: GAP_Y, ranksep: GAP_X, marginx: 0, marginy: 0 });

  const scopeIds = new Set(steps.map(s => s.id));
  for (const s of steps) {
    const sz = sizes.get(s.id)!;
    g.setNode(s.id, { width: sz.w, height: sz.h });
  }
  for (const s of steps) {
    for (const dep of s.dependsOn ?? []) {
      if (scopeIds.has(dep)) g.setEdge(dep, s.id);
    }
  }
  dagre.layout(g);

  const positions = new Map<string, NodePos>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of steps) {
    const n = g.node(s.id);
    const sz = sizes.get(s.id)!;
    const x = n.x - sz.w / 2;
    const y = n.y - sz.h / 2;
    positions.set(s.id, { x, y });
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + sz.w > maxX) maxX = x + sz.w;
    if (y + sz.h > maxY) maxY = y + sz.h;
  }
  // Normalize to (0, 0)
  const offsetX = -minX;
  const offsetY = -minY;
  for (const [id, p] of positions) {
    positions.set(id, { x: p.x + offsetX, y: p.y + offsetY });
  }

  resolveVerticalOverlaps(positions, sizes);

  // Recompute bbox after overlap resolution (y may have grown)
  let bMinY = Infinity, bMaxY = -Infinity, bMinX = Infinity, bMaxX = -Infinity;
  for (const [id, p] of positions) {
    const sz = sizes.get(id)!;
    if (p.x < bMinX) bMinX = p.x;
    if (p.y < bMinY) bMinY = p.y;
    if (p.x + sz.w > bMaxX) bMaxX = p.x + sz.w;
    if (p.y + sz.h > bMaxY) bMaxY = p.y + sz.h;
  }

  return {
    w: bMaxX - bMinX,
    h: bMaxY - bMinY,
    positions,
    sizes,
  };
}

/**
 * Post-process dagre positions so that no two boxes overlap visually.
 * Dagre allocates rank-internal y by node center with nodesep spacing, but when
 * one sibling is a tall container (e.g. h=400) and the other a short leaf
 * (h=52), the short leaf can end up inside the container's vertical bbox.
 * This pushes the lower-top sibling down until the y ranges clear.
 */
function resolveVerticalOverlaps(
  positions: Map<string, NodePos>,
  sizes: Map<string, NodeSize>,
): void {
  const ids = Array.from(positions.keys());
  if (ids.length < 2) return;

  for (let guard = 0; guard < 8; guard++) {
    let changed = false;
    const boxes = ids.map(id => {
      const p = positions.get(id)!;
      const s = sizes.get(id)!;
      return { id, l: p.x, r: p.x + s.w, t: p.y, b: p.y + s.h };
    }).sort((a, b) => a.t - b.t);

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i], B = boxes[j];
        const xOverlap = A.l < B.r && B.l < A.r;
        const yOverlap = A.t < B.b && B.t < A.b;
        if (xOverlap && yOverlap) {
          const shift = A.b + GAP_Y - B.t;
          if (shift > 0) {
            const p = positions.get(B.id)!;
            positions.set(B.id, { x: p.x, y: p.y + shift });
            B.t += shift; B.b += shift;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
}

// ── Ownership ─────────────────────────────────────────────────────────────

/**
 * Map each step id to its immediate container parent id (if any).
 */
export function buildParentMap(steps: LayoutStep[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of steps) {
    if (!isContainer(s)) continue;
    for (const id of getBodyIds(s)) m.set(id, s.id);
  }
  return m;
}

/**
 * Walk up the parent chain and collect ancestor ids (nearest first).
 */
export function ancestorsOf(stepId: string, parentMap: Map<string, string>): string[] {
  const chain: string[] = [];
  let cur = parentMap.get(stepId);
  while (cur) {
    chain.push(cur);
    cur = parentMap.get(cur);
  }
  return chain;
}

/**
 * True if the workflow has any container nested inside another container —
 * used to decide whether old absolute `metadata.position` can still be trusted.
 */
export function hasNestedContainers(steps: LayoutStep[]): boolean {
  const stepMap = new Map(steps.map(s => [s.id, s]));
  for (const s of steps) {
    if (!isContainer(s)) continue;
    for (const childId of getBodyIds(s)) {
      const child = stepMap.get(childId);
      if (child && isContainer(child)) return true;
    }
  }
  return false;
}
