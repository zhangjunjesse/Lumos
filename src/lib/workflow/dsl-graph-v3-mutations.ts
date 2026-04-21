/**
 * V3 节点增删操作。
 *
 * 当前只需要 removeNodeFromDsl; add 由外层 body-manager/ reducer 直接拼 edges 完成。
 */
import type { WorkflowDSLV3 } from './types-v3';
import { findOutgoingEdge } from './dsl-graph-v3-edges';

/**
 * 移除节点 + 所有入/出边, 并把 `next` 链上的前驱直接接到原节点的 `next` 后继(如有)。
 * 不触碰 then/else/body 入边 —— 上层 API 会根据节点角色决定是否同时更新容器分支。
 */
export function removeNodeFromDsl(dsl: WorkflowDSLV3, nodeId: string): WorkflowDSLV3 {
  const nextTarget = findOutgoingEdge(dsl.edges, nodeId, 'next')?.to;
  const nextPreds = dsl.edges
    .filter((e) => e.kind === 'next' && e.to === nodeId)
    .map((e) => e.from);

  const edges = dsl.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);

  if (nextTarget) {
    for (const pred of nextPreds) {
      if (!edges.some((e) => e.from === pred && e.to === nextTarget && e.kind === 'next')) {
        edges.push({ from: pred, to: nextTarget, kind: 'next' });
      }
    }
  }

  // 若被删除节点是容器入口(来自 then/else/body), 不在此重链接 —— 上层应先调用
  // rewriteContainerChain 清空该分支, 再调用本函数。
  const nodes = dsl.nodes.filter((n) => n.id !== nodeId);
  return { ...dsl, nodes, edges };
}
