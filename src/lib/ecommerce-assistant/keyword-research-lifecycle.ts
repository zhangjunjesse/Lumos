/**
 * 类目&关键词调研 —— 运行生命周期（自有内存 abort 注册表 + 取消对账）。
 * 与资讯调研 research-lifecycle 同形不同表，两域互不影响。
 */
import { getKeywordStore, getKeywordRun, patchKeywordRun } from './keyword-research-storage';

const KEY = '__lumos_ecom_keyword_research_runs';

interface LifecycleState {
  controllers: Map<string, AbortController>;
}

function state(): LifecycleState {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[KEY]) g[KEY] = { controllers: new Map() } satisfies LifecycleState;
  return g[KEY] as LifecycleState;
}

const NON_TERMINAL = new Set(['pending', 'running']);

export function registerKeywordRun(id: string): AbortController | null {
  const s = state();
  if (s.controllers.has(id)) return null;
  const c = new AbortController();
  s.controllers.set(id, c);
  return c;
}

export function unregisterKeywordRun(id: string): void {
  state().controllers.delete(id);
}

export function isKeywordRunActive(id: string): boolean {
  return state().controllers.has(id);
}

function abortKeywordRun(id: string): boolean {
  const c = state().controllers.get(id);
  if (!c) return false;
  c.abort();
  return true;
}

/**
 * 取消：有 live controller → 中断（runner 的 finally 写终态）；无 controller
 * 但行非终态 → 进程重启后的 zombie，直接对账成 cancelled 让 UI 脱困。
 */
export function cancelKeywordRun(id: string): boolean {
  if (abortKeywordRun(id)) return true;
  const store = getKeywordStore();
  const row = getKeywordRun(store, id);
  if (row && NON_TERMINAL.has(String(row.status))) {
    patchKeywordRun(store, id, {
      status: 'cancelled',
      stage: 'cancelled',
      error: '任务被取消（进程重启后无运行态，已对账为已取消）',
      completed_at: new Date().toISOString(),
    });
    return true;
  }
  return false;
}
