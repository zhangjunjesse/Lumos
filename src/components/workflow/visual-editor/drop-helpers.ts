import type { Node } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import {
  BRANCH_GAP,
  BRANCH_LABEL_H,
  CONT_HEADER_H,
  NODE_W,
  NODE_H,
} from '@/lib/workflow/dsl-graph-layout';

export interface DropTarget {
  containerId: string;
  relativePos: { x: number; y: number };
  branch?: 'then' | 'else';
}

interface AbsBox {
  id: string;
  absX: number;
  absY: number;
  w: number;
  h: number;
  data: StepNodeData;
  thenBlockH?: number;
}

function sizeOf(n: Node): { w: number; h: number } {
  return {
    w: (n.style?.width as number | undefined) ?? NODE_W,
    h: (n.style?.height as number | undefined) ?? NODE_H,
  };
}

function absPosOf(n: Node, byId: Map<string, Node>): { x: number; y: number } {
  let x = n.position.x;
  let y = n.position.y;
  let cur = n.parentId;
  while (cur) {
    const p = byId.get(cur);
    if (!p) break;
    x += p.position.x;
    y += p.position.y;
    cur = p.parentId;
  }
  return { x, y };
}

/**
 * Find the deepest container whose absolute rectangle contains (flowX, flowY).
 * Returns the drop target (container id + position relative to that container +
 * optional then/else branch for if-else). Excludes `draggedNodeId` and its descendants.
 */
export function findContainerAt(
  nodes: Node<StepNodeData>[],
  flowPos: { x: number; y: number },
  draggedNodeId?: string,
): DropTarget | null {
  const byId = new Map(nodes.map(n => [n.id, n]));

  const excluded = new Set<string>();
  if (draggedNodeId) {
    excluded.add(draggedNodeId);
    // Exclude descendants so you can't drop a container into itself
    const queue = [draggedNodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of nodes) {
        if (n.parentId === cur && !excluded.has(n.id)) {
          excluded.add(n.id);
          queue.push(n.id);
        }
      }
    }
  }

  const boxes: AbsBox[] = [];
  for (const n of nodes) {
    if (excluded.has(n.id) || !n.data.isContainer) continue;
    const abs = absPosOf(n, byId);
    const { w, h } = sizeOf(n);
    boxes.push({
      id: n.id, absX: abs.x, absY: abs.y, w, h,
      data: n.data,
      thenBlockH: n.data.thenBlockH,
    });
  }

  // Find smallest (deepest) container containing the point
  let best: AbsBox | null = null;
  for (const b of boxes) {
    if (
      flowPos.x >= b.absX && flowPos.x <= b.absX + b.w &&
      flowPos.y >= b.absY && flowPos.y <= b.absY + b.h
    ) {
      if (!best || b.w * b.h < best.w * best.h) best = b;
    }
  }
  if (!best) return null;

  const relX = flowPos.x - best.absX;
  const relY = flowPos.y - best.absY;

  let branch: 'then' | 'else' | undefined;
  if (best.data.stepType === 'if-else') {
    const thenH = best.thenBlockH ?? 0;
    const elseStartY = CONT_HEADER_H + BRANCH_LABEL_H + thenH + BRANCH_GAP;
    branch = relY >= elseStartY ? 'else' : 'then';
  }

  return { containerId: best.id, relativePos: { x: relX, y: relY }, branch };
}
