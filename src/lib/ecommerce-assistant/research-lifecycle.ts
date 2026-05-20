/**
 * Single lifecycle control surface for research reports.
 *
 * CLAUDE.md 任务生命周期规则要求不要在 route handler 里散写「取消 / 删除 /
 * 终态对账」逻辑，必须集中到统一控制服务。本模块拥有内存里的
 * AbortController 注册表，并提供：
 *
 * - 取消：中断正在运行的后台任务（runner 的 finally 会写 `cancelled`）。
 * - 对账：进程重启后注册表清空，残留的 `queued/running` 行没有任何 live
 *   controller —— 它们是 zombie，必须被写成终态，否则 UI 永远卡在「运行中」。
 * - 删除：先取消再删（cancel-then-delete），杜绝「记录已删但后台还在跑、
 *   还在 patch 已删除行、还在烧 LLM/浏览器预算」。
 */

import {
  deleteResearchReport,
  getResearchReport,
  getResearchStore,
  listResearchReports,
  patchResearchReport,
} from './research-storage';

const REGISTRY_KEY = '__lumos_ecommerce_research_registry';

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

const NON_TERMINAL = new Set(['queued', 'running']);

/**
 * 同步登记一次运行。返回 controller；若该 id 已在运行返回 null，调用方据此
 * 提前返回（避免重复后台执行）。`startReport` 必须在返回前同步调用本函数，
 * 以消除「行已建但 controller 未注册」与并发对账之间的竞态。
 */
export function registerRun(id: string): AbortController | null {
  const state = getState();
  if (state.controllers.has(id)) return null;
  const controller = new AbortController();
  state.controllers.set(id, controller);
  return controller;
}

export function unregisterRun(id: string): void {
  getState().controllers.delete(id);
}

export function isReportRunning(id: string): boolean {
  return getState().controllers.has(id);
}

/** 仅中断 live controller（不写 DB）；用于「删除前先停后台工作」。 */
export function abortRun(id: string): boolean {
  const controller = getState().controllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

/**
 * 取消报告。签名保持 `(id) => boolean` 向后兼容（cancel route / mcp-server）。
 * - 有 live controller：中断，runner 的 finally 会把行写成 `cancelled`。
 * - 无 controller 但行仍非终态：是进程重启后的 zombie，直接对账成 `cancelled`，
 *   让 UI 逃出「运行中」死态。
 * - 行已终态 / 不存在：返回 false。
 */
export function cancelReport(id: string): boolean {
  if (abortRun(id)) return true;
  const store = getResearchStore();
  const row = getResearchReport(store, id);
  if (row && NON_TERMINAL.has(String(row.status))) {
    patchResearchReport(store, id, {
      status: 'cancelled',
      stage: 'cancelled',
      error: '任务被取消（进程重启后无运行态，已对账为已取消）',
      failure_stage: 'cancelled',
      completed_at: new Date().toISOString(),
    });
    return true;
  }
  return false;
}

/**
 * 自愈：把没有 live controller 的残留 `queued/running` 行写成终态。
 * 由 list GET 与 startReport 触发，无需全局启动钩子。返回对账条数。
 */
export function reconcileOrphans(): number {
  const store = getResearchStore();
  let fixed = 0;
  for (const status of ['running', 'queued'] as const) {
    for (const row of listResearchReports(store, { status, limit: 500 })) {
      if (isReportRunning(row.id)) continue;
      patchResearchReport(store, row.id, {
        status: 'failed',
        stage: 'error',
        error: '任务进程已重启，执行中断（未完成）。可点「重新跑」。',
        failure_stage: 'interrupted',
        completed_at: new Date().toISOString(),
      });
      fixed += 1;
    }
  }
  return fixed;
}

/** 删除报告：先取消正在运行的后台任务，再删可见记录与磁盘 md。 */
export function deleteReportWithCancel(id: string): boolean {
  abortRun(id);
  unregisterRun(id);
  return deleteResearchReport(getResearchStore(), id);
}

/** 可清理的终态（失败/已取消）。已完成报告是调研产出，绝不在此清理。 */
const CLEANABLE_STATUSES = ['failed', 'cancelled'] as const;
export type CleanableStatus = (typeof CLEANABLE_STATUSES)[number];

/**
 * 批量清理终态报告。复用 cancel-then-delete，用户自助清列表堆积。
 * 语义（破坏性操作取保守）：
 * - 不传 / 空数组 → 清理全部可清理终态（failed + cancelled）。
 * - 传了数组 → 仅清理其中合法的可清理终态；非法项忽略；若一个合法的都
 *   没有，则**删 0**（不升级成「全删」，避免坏输入导致超额删除）。
 * 已完成 / 运行中 / 排队报告永不参与。返回实际删除条数。
 */
export function cleanupReports(statuses?: readonly string[]): number {
  const targets = (statuses && statuses.length > 0
    ? statuses.filter((s): s is CleanableStatus =>
        (CLEANABLE_STATUSES as readonly string[]).includes(s))
    : CLEANABLE_STATUSES) as readonly CleanableStatus[];
  const store = getResearchStore();
  let removed = 0;
  for (const status of targets) {
    for (const row of listResearchReports(store, { status, limit: 500 })) {
      if (deleteReportWithCancel(row.id)) removed += 1;
    }
  }
  return removed;
}

/**
 * 批量删除 UI 显式勾选的报告。每个 id 复用 cancel-then-delete：先中断正在
 * 运行的后台任务，再删可见记录与磁盘 md（CLAUDE.md 生命周期规则）。
 *
 * 与 cleanupReports 的区别：cleanup 按 status 保守清理、永不碰已完成报告；
 * 这里是用户在列表里逐项勾选的 id —— 显式选择即用户意图，任何状态（含已
 * 完成产出、运行中）都可删。去重；空白 / 未知 id 静默跳过；返回实际删除条数。
 */
export function deleteReportsByIds(ids: readonly string[]): number {
  const unique = [...new Set(ids.map((s) => String(s).trim()).filter(Boolean))];
  let removed = 0;
  for (const id of unique) {
    if (deleteReportWithCancel(id)) removed += 1;
  }
  return removed;
}
