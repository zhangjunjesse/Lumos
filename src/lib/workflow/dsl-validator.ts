/**
 * V3 DSL 结构校验器 — 门面。
 *
 * 14 条 check 按维度拆到 4 个子模块, 本文件只保留类型、公共 API 和调度。
 *   - dsl-validator-ids.ts         — 节点 id 去重
 *   - dsl-validator-edges.ts       — 边端点 / kind / 出度 / on-error 一致性
 *   - dsl-validator-topology.ts    — entry / reachability / cycles / parallel-join
 *   - dsl-validator-references.ts  — steps.X.output.* 引用 / loop-var 作用域
 *   - dsl-validator-goto.ts        — onError.goto 跨循环 / 运行时支持
 */
import { buildGraphIndex } from './dsl-validator-graph';
import type { WorkflowDSLV3 } from './types-v3';
import { checkDuplicateIds } from './dsl-validator-ids';
import {
  checkEdgeEndpoints,
  checkEdgeKindPerSource,
  checkOnErrorConsistency,
  checkOutDegree,
} from './dsl-validator-edges';
import {
  checkEntry,
  checkIllegalCycles,
  checkParallelBranchLimit,
  checkParallelJoin,
  checkReachability,
} from './dsl-validator-topology';
import {
  checkLoopVarScope,
  checkReferencesTopoPredecessor,
} from './dsl-validator-references';
import {
  checkGotoAcrossLoop,
  checkGotoRuntimeSupport,
} from './dsl-validator-goto';

export type {
  IssueEmit,
  ValidationIssue,
  ValidationReport,
  ValidationSeverity,
} from './dsl-validator-types';

export function validateDslStructure(dsl: WorkflowDSLV3): import('./dsl-validator-types').ValidationReport {
  const issues: import('./dsl-validator-types').ValidationIssue[] = [];
  const emit: import('./dsl-validator-types').IssueEmit = (i) => { issues.push(i); };

  checkDuplicateIds(dsl, emit);
  checkEdgeEndpoints(dsl, emit);

  const index = buildGraphIndex(dsl);
  checkEdgeKindPerSource(index, emit);
  checkOutDegree(index, emit);
  checkOnErrorConsistency(index, emit);
  checkEntry(index, emit);
  checkReachability(index, emit);
  checkIllegalCycles(index, emit);
  checkParallelJoin(index, emit);
  checkParallelBranchLimit(index, emit);
  checkReferencesTopoPredecessor(index, emit);
  checkLoopVarScope(index, emit);
  checkGotoAcrossLoop(index, emit);
  checkGotoRuntimeSupport(index, emit);

  return { valid: issues.every((i) => i.severity !== 'error'), issues };
}
