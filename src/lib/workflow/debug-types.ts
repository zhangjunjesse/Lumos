// 工作流调试模式 — 共享契约类型
//
// 用户场景：一个长链路工作流（含容器），用户希望"跑到 step X 停下，
// 反复重跑 X 直到满意，再从 X 继续跑剩下的"，避免下游浪费时间。
//
// 设计：每个 step 完成都是 checkpoint；不引入"断点"概念。
// 一个工作流对应一份持久化的 debug session（session 内存 step 输出快照）。
//
// 三种调试模式（运行时通过 DebugRunRequest 传入）：
//   run-to        — 跑所有 X 上游（命中缓存就跳过执行），执行 X，X 完成后停
//   rerun-only    — 清掉 X + 所有下游缓存；执行 X（用现有上游缓存），X 完成后停
//   continue-from — X 必须已缓存；跳过 ≤ X 的所有节点，执行 X 之后所有节点到末尾
//
// 容器（while/for-each/if-else）在 V1 作为整体 checkpoint：
//   - 容器自身有 cache 项（缓存其聚合 output: { state, iterations, ... }）
//   - 容器内部 body step 不单独支持 run-to / rerun（UI 灰掉）
//   - 整体重跑时容器 + 所有 body step 缓存一起清

import type { JsonValue } from './types';

/** 持久化在 workflow_debug_sessions 表的一行。 */
export interface DebugSession {
  id: string;
  workflowId: string;
  status: 'idle' | 'running' | 'error';
  createdAt: string;
  updatedAt: string;
}

/** 持久化在 workflow_debug_step_outputs 表的一行。 */
export interface DebugStepOutput {
  sessionId: string;
  stepId: string;
  /** 完整 StepResult.output（小于阈值时内联存储；超过则 outputBlobPath 不空，output 字段为 null） */
  output: unknown;
  metadata: Record<string, JsonValue>;
  status: 'success' | 'error';
  error?: string;
  durationMs: number;
  completedAt: string;
  /** sha256(step.input + step.policy + step.when) — 检测节点配置是否被改过 */
  configHash: string;
  /** 大输出（>64KB）落盘后的相对路径（相对 ~/.lumos/debug/<sessionId>/） */
  outputBlobPath?: string | null;
}

/** 调试运行请求 — 来自前端 API。 */
export interface DebugRunRequest {
  workflowId: string;
  mode: 'run-to' | 'rerun-only' | 'continue-from';
  /** 目标 step；run-to / rerun-only 必须；continue-from 必须且该 step 必须已有缓存 */
  targetStepId: string;
}

/** session 当前快照 — UI 渲染节点角标用。 */
export interface DebugSessionSnapshot {
  session: DebugSession | null;
  /** stepId → 缓存元数据（不含 output payload，避免一次拉满） */
  cachedSteps: Record<string, DebugStepCacheMeta>;
  /** 最近一次 debug run 的 schedule_run_history.id，用于跳转到完整执行记录页 */
  latestRunId: string | null;
}

export interface DebugStepCacheMeta {
  stepId: string;
  status: 'success' | 'error';
  /** 节点配置是否变过（hash 不再匹配） */
  stale: boolean;
  durationMs: number;
  completedAt: string;
}

/** 引擎层在执行步骤前查询的内存缓存（来自 DB 加载）。 */
export interface DebugRuntimeContext {
  sessionId: string;
  mode: 'run-to' | 'rerun-only' | 'continue-from';
  targetStepId: string;
  /** stepId → 完整缓存（命中即返回缓存 output） */
  cache: Map<string, DebugStepOutput>;
  /** stepId → 应当 noop 的 step 集合（target 之外的下游 / 不相关的节点） */
  skipSet: Set<string>;
  /** stepId → 当前节点的 configHash（用于命中前 hash 校验 + 命中后写回） */
  configHashes: Map<string, string>;
  /**
   * Whether real step results should be written back to workflow_debug_step_outputs.
   * Production reruns reuse this runtime cache path but must stay run-scoped.
   */
  persist?: boolean;
}

/** 缓存命中时返回的合成结果（runtime 包装层用）。 */
export interface DebugCacheHit {
  fromCache: true;
  output: unknown;
  metadata: Record<string, JsonValue>;
}

/** skip 集合命中时返回的合成结果。 */
export interface DebugSkipResult {
  skipped: true;
  reason: 'debug-skip-after-target' | 'debug-skip-unrelated';
}
