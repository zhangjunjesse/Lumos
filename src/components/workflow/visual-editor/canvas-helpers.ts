import type { Node } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';

export interface DslStep {
  id: string;
  type: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
  metadata?: { position?: { x: number; y: number } };
}

export interface DslSpec {
  version: string;
  name: string;
  description?: string;
  steps: DslStep[];
}

export function genId(type: string): string {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

export function defaultInputForType(type: string): Record<string, unknown> {
  switch (type) {
    case 'agent': return { prompt: '', role: 'worker' };
    case 'if-else': return { condition: { op: 'exists', ref: 'input.flag' }, then: [] };
    case 'for-each': return { collection: 'input.items', itemVar: 'item', body: [] };
    case 'while': return { condition: { op: 'exists', ref: 'input.hasMore' }, body: [], maxIterations: 20 };
    case 'wait': return { durationMs: 5000 };
    default: return {};
  }
}

/**
 * Merge a transient `isDropTarget` flag into node data for the container currently
 * receiving a drag hover (used to draw the green dashed highlight).
 */
export function applyDropTargetFlag(
  nodes: Node<StepNodeData>[],
  dropTargetId: string | null,
): Node<StepNodeData>[] {
  return nodes.map(n => {
    const flag = n.id === dropTargetId;
    if ((n.data.isDropTarget ?? false) === flag) return n;
    return { ...n, data: { ...n.data, isDropTarget: flag } };
  });
}
