/**
 * V3 on-error 边同步。
 *
 * 约定: 任一节点至多 1 条 `on-error` 出边。onError.action='goto' 且 target 指向
 * 存在节点时写入; 其它情况移除 on-error 出边。
 */
import type { WorkflowDSLV3, WorkflowEdge } from './types-v3';

/**
 * 根据节点的 `onError.action` 与 `onError.target` 重建唯一的 `on-error` 出边。
 */
export function syncOnErrorEdge(dsl: WorkflowDSLV3, nodeId: string): WorkflowDSLV3 {
  const node = dsl.nodes.find((n) => n.id === nodeId);
  if (!node) return dsl;
  const filtered = dsl.edges.filter(
    (e) => !(e.from === nodeId && e.kind === 'on-error'),
  );
  const target = node.onError?.action === 'goto' ? node.onError.target : undefined;
  const validTarget = target && dsl.nodes.some((n) => n.id === target) ? target : undefined;
  if (!validTarget) return { ...dsl, edges: filtered };
  return {
    ...dsl,
    edges: [...filtered, { from: nodeId, to: validTarget, kind: 'on-error' }],
  };
}

/** 读取当前节点的 on-error 目标(若存在)。 */
export function findOnErrorTarget(
  edges: readonly WorkflowEdge[],
  nodeId: string,
): string | undefined {
  return edges.find((e) => e.from === nodeId && e.kind === 'on-error')?.to;
}
