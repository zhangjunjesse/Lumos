/**
 * 选品研究记录（discover research run）的统一生命周期控制面。
 *
 * 一条「研究记录」= 同一 `research_id` 下的全部 `discover_candidates`
 * （含 `研究中…` 占位行）。run 本身不是持久实体，是按 research_id 的派生视图
 * （见 DiscoverTab.buildResearchRuns）。
 *
 * CLAUDE.md 任务生命周期规则要求不在 route handler 里散写「取消 / 删除」逻辑，
 * 集中到统一控制服务。本模块拥有内存里按 researchId 的 AbortController 注册表，
 * 与调研侧 research-lifecycle 对称：
 *
 * - 取消：中断仍在跑的后台研究（startDiscoverResearch 是 fire-and-forget，
 *   completeDiscoverResearch 及其下游 fetch/LLM/图片已全程接受 abortSignal）。
 * - 删除：先取消再删（cancel-then-delete），杜绝「记录已删但后台还在跑、
 *   还在 patch 已删除行、还在烧 LLM/浏览器预算」。
 */

import type { AppDataStore } from '@/lib/app/runtime/data-store';

import { getCandidate, getEcommerceStore, getInput, listCandidates } from './storage';
import { deleteSelectionEvidenceByResearchId } from './discover-evidence-storage';

const REGISTRY_KEY = '__lumos_ecommerce_discover_registry';
const LEGACY_PREFIX = 'legacy-';

interface RegistryState {
  controllers: Map<string, AbortController>;
}

function getState(): RegistryState {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[REGISTRY_KEY]) {
    g[REGISTRY_KEY] = { controllers: new Map<string, AbortController>() };
  }
  return g[REGISTRY_KEY] as RegistryState;
}

/**
 * 同步登记一次运行。返回 controller；若该 id 已在运行返回 null。
 * researchId 每次新生成（createResearchPlaceholder），实践中不会撞，
 * 保留 null 分支与调研侧语义一致。
 */
export function registerDiscoverRun(id: string): AbortController | null {
  const state = getState();
  if (state.controllers.has(id)) return null;
  const controller = new AbortController();
  state.controllers.set(id, controller);
  return controller;
}

export function unregisterDiscoverRun(id: string): void {
  getState().controllers.delete(id);
}

export function isDiscoverRunRunning(id: string): boolean {
  return getState().controllers.has(id);
}

/** 仅中断 live controller（不动 DB）；用于「删除前先停后台研究」。 */
export function abortDiscoverRun(id: string): boolean {
  const controller = getState().controllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

export interface DeleteRunsResult {
  /** 至少删掉一条候选行的 run 数。全 promoted 的 run 不计入。 */
  removedRuns: number;
  /** 实际删除的候选行总数（含 `研究中…` 占位、failed 行）。 */
  removedCandidates: number;
  /** 跳过未删的 promoted 候选数（已转工坊，删它会切断流水线追溯）。 */
  skippedPromoted: number;
}

/**
 * 候选是否「真·promoted」= 已转工坊且下游 product_input 仍存在。
 * 只有这种才需要保护（删它会切断流水线追溯）。promoted 但 product_input
 * 已被独立硬删（inputs/[id] DELETE 不回写候选）= 孤儿，无下游可保护，
 * 按可删处理——否则这条研究记录永远删不掉，提示还指向空工坊。
 * 单删 DELETE /discover/[id] 与批量删共用此判定，语义一致。
 */
export function isProtectedPromoted(
  store: AppDataStore,
  row: { status: string; promoted_input_id?: string | null },
): boolean {
  if (row.status !== 'promoted') return false;
  if (!row.promoted_input_id) return false;
  return getInput(store, row.promoted_input_id) !== null;
}

/**
 * 批量删除 UI 显式勾选的选品研究记录（run id 即 research_id，
 * 或无 research_id 的 legacy 行用 `legacy-<candidateId>`）。
 *
 * 每个 run 走 cancel-then-delete：先中断仍在跑的后台研究，unregister，
 * 再删该 research_id 名下全部候选。仅「真·promoted」（下游 product_input
 * 仍存在）保留并计数（isProtectedPromoted，与单删 409 共用判定）；孤儿
 * promoted 正常删。去重；空白 / 未知 id 静默跳过；返回各项计数。
 */
export function deleteResearchRunsByIds(runIds: readonly string[]): DeleteRunsResult {
  const unique = [...new Set(runIds.map((s) => String(s).trim()).filter(Boolean))];
  const store = getEcommerceStore();
  const result: DeleteRunsResult = {
    removedRuns: 0,
    removedCandidates: 0,
    skippedPromoted: 0,
  };

  for (const runId of unique) {
    abortDiscoverRun(runId);
    unregisterDiscoverRun(runId);

    const rows = runId.startsWith(LEGACY_PREFIX)
      ? [getCandidate(store, runId.slice(LEGACY_PREFIX.length))].filter(
          (row): row is NonNullable<typeof row> => row !== null,
        )
      : listCandidates(store, { research_id: runId });

    let removedHere = 0;
    for (const row of rows) {
      if (isProtectedPromoted(store, row)) {
        result.skippedPromoted += 1;
        continue;
      }
      if (store.delete('discover_candidates', row.id)) {
        result.removedCandidates += 1;
        removedHere += 1;
      }
    }
    if (
      !runId.startsWith(LEGACY_PREFIX) &&
      listCandidates(store, { research_id: runId }).length === 0
    ) {
      deleteSelectionEvidenceByResearchId(store, runId);
    }
    if (removedHere > 0) result.removedRuns += 1;
  }

  return result;
}
