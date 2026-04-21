/**
 * V3 parallel 分支 (next 出边 + branchIndex) 的读取与重排。
 */
import type { WorkflowDSLV3, WorkflowEdge } from './types-v3';

export interface ParallelBranchRef {
  targetId: string;
  branchIndex: number;
}

/** 读取 parallel 节点所有分支(按 branchIndex 升序; 缺省值排到尾部)。 */
export function extractParallelBranches(
  parallelId: string,
  edges: readonly WorkflowEdge[],
): ParallelBranchRef[] {
  const outs = edges.filter((e) => e.from === parallelId && e.kind === 'next');
  return outs
    .map((e) => ({
      targetId: e.to,
      branchIndex: typeof e.branchIndex === 'number' ? e.branchIndex : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.branchIndex - b.branchIndex || a.targetId.localeCompare(b.targetId));
}

/**
 * 按 `order` 给出的 targetId 序列重写 parallel 节点的 next 出边 branchIndex。
 * 未出现在 order 中的旧分支保持不变(防止误删)。
 */
export function reorderParallelBranches(
  dsl: WorkflowDSLV3,
  parallelId: string,
  order: readonly string[],
): WorkflowDSLV3 {
  const known = new Set(order);
  const next = dsl.edges.map((e) => {
    if (e.from !== parallelId || e.kind !== 'next') return e;
    if (!known.has(e.to)) return e;
    return { ...e, branchIndex: order.indexOf(e.to) };
  });
  return { ...dsl, edges: next };
}
