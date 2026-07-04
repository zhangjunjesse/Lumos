import { MONITOR_AUTOMATION_ID, MONITOR_NATIVE_ACTION } from '@/lib/amazon-rank/constants';
import { recoverStaleRuns } from '@/lib/amazon-rank/store';

import type { AppDataStore, AppRow } from './runtime/data-store';

export interface AmazonRankAutomationRow extends Record<string, unknown> {
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

const DEFAULT_MONITOR: AmazonRankAutomationRow & { id: string; native_action: string } = {
  id: MONITOR_AUTOMATION_ID,
  title: '每日排名监控',
  enabled: false,
  schedule: '每天 09:00',
  native_action: MONITOR_NATIVE_ACTION,
  description:
    '按监控清单（关键词 + ASIN）自动查一遍自然搜索排名，结果进运行记录；绑定了微信 IM 时推送摘要。',
  last_status: 'idle',
  schedule_status: 'not_connected',
  schedule_error: '',
  next_run_at: null,
  last_run_summary: '默认关闭。先在「查询」页跑一次，结果页点「设为每日监控」即可开启。',
};

export function ensureAmazonRankDefaultAutomations(store: AppDataStore): void {
  ensureRow(store, DEFAULT_MONITOR);
  recoverStaleRuns(store);
}

function ensureRow(
  store: AppDataStore,
  desired: AmazonRankAutomationRow & { id: string; native_action: string },
): AppRow<AmazonRankAutomationRow> {
  const byAction = store
    .query<AmazonRankAutomationRow>('app_automations', { limit: 100 })
    .find(
      (row) =>
        (row.native_action ?? '').trim().toLowerCase() === desired.native_action.toLowerCase(),
    );
  const existing = byAction ?? store.get<AmazonRankAutomationRow>('app_automations', desired.id);
  if (!existing) {
    return store.create<AmazonRankAutomationRow>('app_automations', desired);
  }

  const patch: Partial<AmazonRankAutomationRow> = {};
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
  return store.update<AmazonRankAutomationRow>('app_automations', existing.id, patch) ?? existing;
}
