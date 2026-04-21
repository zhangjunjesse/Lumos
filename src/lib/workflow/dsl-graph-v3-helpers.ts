/**
 * V3 图结构操作 — 门面。
 *
 * V3 把结构信息完全移到 `edges[]` 上, container 通过出边 kind (then/else/body/next)
 * "拥有"子节点, 不再用 `input.then/else/body` 数组表达。
 *
 * 为便于演进与复用, 按维度拆到 5 个子模块, 本文件只做再导出, 保持现有调用方
 * (converter / canvas / body-manager / debug-cache / 各测试) 的 import 不变。
 *
 *   - dsl-graph-v3-edges.ts      — 基础访问 / 链上行走
 *   - dsl-graph-v3-container.ts  — if-else / for-each / while 分支读写 & 顶层前驱
 *   - dsl-graph-v3-mutations.ts  — 节点增删
 *   - dsl-graph-v3-on-error.ts   — on-error 边同步
 *   - dsl-graph-v3-parallel.ts   — parallel next 分支读写
 */

export {
  findOutgoingEdge,
  outgoingEdges,
  incomingEdges,
  countIncoming,
  countOutgoingByKind,
  walkNextChainUntil,
  collectNextReachable,
} from './dsl-graph-v3-edges';

export type { IfElseBranches, ContainerOwnership, ContainerChainUpdate } from './dsl-graph-v3-container';
export {
  extractIfElseBranches,
  extractBodyChain,
  computeContainerOwnership,
  isContainerNodeType,
  rewriteContainerChain,
  computeTopLevelPredecessors,
  findContainerOwner,
} from './dsl-graph-v3-container';

export { removeNodeFromDsl } from './dsl-graph-v3-mutations';

export { syncOnErrorEdge, findOnErrorTarget } from './dsl-graph-v3-on-error';

export type { ParallelBranchRef } from './dsl-graph-v3-parallel';
export { extractParallelBranches, reorderParallelBranches } from './dsl-graph-v3-parallel';
