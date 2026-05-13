import type { AppDataStore, AppRow } from './runtime/data-store';

export const DEEP_RESEARCH_ADVANCE_TASKS_ID = 'deep-research-advance-tasks';
export const DEEP_RESEARCH_TOPUP_EVIDENCE_ID = 'deep-research-topup-evidence';

export interface DeepResearchAutomationRow extends Record<string, unknown> {
  title?: string;
  enabled?: boolean;
  schedule?: string;
  native_action?: string;
  description?: string;
  last_status?: 'not_connected' | 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  last_run_summary?: string;
  last_run_id?: string;
  schedule_id?: string;
  schedule_status?: 'not_connected' | 'scheduled' | 'paused' | 'failed';
  schedule_error?: string;
  next_run_at?: string | null;
  updated_at?: string;
}

const DEFAULTS: Array<DeepResearchAutomationRow & { id: string; native_action: string }> = [
  {
    id: DEEP_RESEARCH_ADVANCE_TASKS_ID,
    title: '调研推进巡更',
    enabled: false,
    schedule: '每天 10:00',
    native_action: 'deep-research:advance-active-tasks',
    description:
      '巡检 active 状态的调研任务：未澄清的提醒澄清；目标书未接受的提醒确认；阻塞超 24 小时的写入风险登记册。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary:
      '默认禁用。开启前请先在「设置」配置默认 LLM、deepsearch 配额、采集来源白名单与「报告样章风格」。',
  },
  {
    id: DEEP_RESEARCH_TOPUP_EVIDENCE_ID,
    title: '证据补全巡更',
    enabled: false,
    schedule: '每天 18:00',
    native_action: 'deep-research:topup-evidence',
    description:
      '巡检综合分析阶段：每个研究问题最低证据条数（默认 3 条 / 不同来源）未达标时，对照已采集来源补抓增量。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary:
      '默认禁用。开启前请检查证据条数门槛、来源白名单、单次补抓上限和命中后写入的目标研究问题。',
  },
];

export function ensureDeepResearchDefaultAutomations(store: AppDataStore): void {
  for (const row of DEFAULTS) {
    ensureRow(store, row);
  }
}

function ensureRow(
  store: AppDataStore,
  desired: DeepResearchAutomationRow & { id: string; native_action: string },
): AppRow<DeepResearchAutomationRow> {
  const byAction = store
    .query<DeepResearchAutomationRow>('app_automations', { limit: 100 })
    .find(
      (row) =>
        (row.native_action ?? '').trim().toLowerCase() ===
        desired.native_action.trim().toLowerCase(),
    );
  const existing = byAction ?? store.get<DeepResearchAutomationRow>('app_automations', desired.id);
  if (!existing) {
    return store.create<DeepResearchAutomationRow>('app_automations', desired);
  }

  const patch: Partial<DeepResearchAutomationRow> = {};
  if (!existing.title) patch.title = desired.title;
  if (!existing.schedule) patch.schedule = desired.schedule;
  if (!existing.native_action) patch.native_action = desired.native_action;
  if (!existing.description) patch.description = desired.description;
  if (!existing.last_status) patch.last_status = desired.last_status;
  if (!existing.last_run_summary) patch.last_run_summary = desired.last_run_summary;
  if (!existing.schedule_status) patch.schedule_status = desired.schedule_status;
  if (existing.schedule_error === undefined) patch.schedule_error = desired.schedule_error;
  if (existing.next_run_at === undefined) patch.next_run_at = desired.next_run_at;
  if (Object.keys(patch).length === 0) return existing;
  return store.update<DeepResearchAutomationRow>('app_automations', existing.id, patch) ?? existing;
}
