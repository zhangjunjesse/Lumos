import type { AppDataStore, AppRow } from './runtime/data-store';

export const DOUYIN_PATROL_CREATORS_ID = 'douyin-patrol-creators';
export const DOUYIN_PATROL_KEYWORDS_ID = 'douyin-patrol-keywords';

export interface DouyinAutomationRow extends Record<string, unknown> {
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

const DEFAULTS: Array<DouyinAutomationRow & { id: string; native_action: string }> = [
  {
    id: DOUYIN_PATROL_CREATORS_ID,
    title: '博主每日巡更',
    enabled: false,
    schedule: '每天 08:30',
    native_action: 'douyin-collector:patrol-creators',
    description: '扫描启用的博主订阅，按 cadence 拉增量视频；触发风控时立即暂停后续。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary:
      '默认禁用。开启前请先在「设置」配置抖音 Cookie 和 knowledge collection 入库目标。',
  },
  {
    id: DOUYIN_PATROL_KEYWORDS_ID,
    title: '关键词跑批',
    enabled: false,
    schedule: '每天 09:30',
    native_action: 'douyin-collector:patrol-keywords',
    description:
      '扫描启用的关键词订阅，按时间窗与去重天数拉视频；命中后入库目标 collection。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary:
      '默认禁用。开启前请检查关键词、时间窗、去重天数和命中后入库的目标 collection。',
  },
];

export function ensureDouyinDefaultAutomations(store: AppDataStore): void {
  for (const row of DEFAULTS) {
    ensureRow(store, row);
  }
}

function ensureRow(
  store: AppDataStore,
  desired: DouyinAutomationRow & { id: string; native_action: string },
): AppRow<DouyinAutomationRow> {
  const byAction = store
    .query<DouyinAutomationRow>('app_automations', { limit: 100 })
    .find(
      (row) =>
        (row.native_action ?? '').trim().toLowerCase() ===
        desired.native_action.trim().toLowerCase(),
    );
  const existing = byAction ?? store.get<DouyinAutomationRow>('app_automations', desired.id);
  if (!existing) {
    return store.create<DouyinAutomationRow>('app_automations', desired);
  }

  const patch: Partial<DouyinAutomationRow> = {};
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
  return store.update<DouyinAutomationRow>('app_automations', existing.id, patch) ?? existing;
}
