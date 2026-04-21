/**
 * Graph-traversal helpers backing the debug-cache module:
 *
 *   - upstream closure (what must run before the target step)
 *   - transitive downstream (what must be invalidated when a step changes)
 *
 * V3-native:结构完全由 edges 表达。
 *   - 上游 = 沿入边反向闭包(忽略 on-error;其他边 kind 都视作执行拓扑的一部分)
 *   - 下游 = 沿出边正向闭包(同样忽略 on-error)
 *
 * 容器归属是"免费"的:
 *   - 子节点在 body / then / else 入边下挂,反向走到容器
 *   - 容器本身的上游通过顶层 next 边继续向上
 */
import type { WorkflowDSLV3, WorkflowEdge } from './types-v3';

/**
 * Upstream closure of `targetId` — 所有通过非 on-error 边反向可达的节点。
 * 不含 `targetId` 自身。
 */
export function computeUpstreamClosure(
  targetId: string,
  dsl: WorkflowDSLV3,
): Set<string> {
  return walkEdges(dsl.edges, targetId, 'backward');
}

/**
 * Transitive downstream of `stepId` — 所有通过非 on-error 边正向可达的节点。
 * 不含 `stepId` 自身。
 */
export function computeTransitiveDownstream(
  stepId: string,
  dsl: WorkflowDSLV3,
): string[] {
  return Array.from(walkEdges(dsl.edges, stepId, 'forward'));
}

function walkEdges(
  edges: readonly WorkflowEdge[],
  seedId: string,
  direction: 'backward' | 'forward',
): Set<string> {
  const out = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [seedId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const edge of edges) {
      if (edge.kind === 'on-error') continue;
      const endpoint = direction === 'backward' ? edge.to : edge.from;
      const neighbor = direction === 'backward' ? edge.from : edge.to;
      if (endpoint !== cur) continue;
      if (neighbor === seedId) continue;
      if (!out.has(neighbor)) {
        out.add(neighbor);
        stack.push(neighbor);
      }
    }
  }
  return out;
}
