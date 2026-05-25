import type { AppDataStore, AppRow } from './runtime/data-store';

export const X_RADAR_MONITOR_PATROL_ID = 'x-radar-patrol-monitor';
export const X_RADAR_TOPIC_PATROL_ID = 'x-radar-patrol-topic';
export const X_RADAR_DIGEST_PATROL_ID = 'x-radar-patrol-digest';
export const X_RADAR_STATS_PATROL_ID = 'x-radar-patrol-stats';

export interface XRadarAutomationRow extends Record<string, unknown> {
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

const DEFAULTS: Array<XRadarAutomationRow & { id: string; native_action: string }> = [
  {
    id: X_RADAR_MONITOR_PATROL_ID,
    title: '监控雷达巡更',
    enabled: false,
    schedule: '每小时',
    native_action: 'x-radar:run-monitor-tasks',
    description: '扫描所有 kind=monitor 且 enabled=true 的任务，按 cadence 拉新推命中规则并写入 radar_alerts；命中且 im_enabled=true 时推 IM。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary: '默认禁用。开启前请在「服务 → X」登录并在任务工作台新建至少一个监控任务。',
  },
  {
    id: X_RADAR_TOPIC_PATROL_ID,
    title: '选题挖掘巡更',
    enabled: false,
    schedule: '每天 09:00',
    native_action: 'x-radar:run-topic-tasks',
    description: '扫描所有 kind=topic 且 enabled=true 的任务，按 cadence 抓证据 + thread 抽取，等 AI 桥接入后回填 topic_reports.report_md。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary: '默认禁用。开启前请检查 topic_max_fetch_per_run、thread 抽取条数和入库 collection 设置。',
  },
  {
    id: X_RADAR_DIGEST_PATROL_ID,
    title: '关注摘要巡更',
    enabled: false,
    schedule: '每天 08:00',
    native_action: 'x-radar:run-digest-tasks',
    description: '扫描所有 kind=digest 且 enabled=true 的任务，按窗口（daily/weekly）拉每人最新推证据，等 AI 桥接入后回填 follow_digests.summary_md。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary: '默认禁用。开启前请确认 @ 列表和摘要窗口。',
  },
  {
    id: X_RADAR_STATS_PATROL_ID,
    title: '数据拆解巡更',
    enabled: false,
    schedule: '每周一 10:00',
    native_action: 'x-radar:run-stats-tasks',
    description: '扫描所有 kind=stats 且 enabled=true 的任务，按采样窗口拉量化数据计算互动率，等 AI 桥接入后回填 stats_reports.report_md。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary: '默认禁用。开启前请确认目标账号 / 话题与采样天数。',
  },
];

export function ensureXRadarDefaultAutomations(store: AppDataStore): void {
  for (const row of DEFAULTS) {
    ensureRow(store, row);
  }
  recoverStaleRunningTasks(store);
}

/**
 * D3 修：进程崩溃 / OS kill / 强退后，radar_tasks 可能残留 last_status='running' 但实际没在跑。
 * 启动时把 10 分钟前还 running 的标记为 failed，让用户能重新跑。
 */
function recoverStaleRunningTasks(store: AppDataStore): void {
  const cutoff = Date.now() - 10 * 60_000;
  const tasks = store.query<{ id: string; last_status?: string; last_run_started_at?: string }>('radar_tasks', { limit: 500 });
  for (const t of tasks) {
    if (t.last_status !== 'running') continue;
    const startedAt = t.last_run_started_at ? Date.parse(t.last_run_started_at) : NaN;
    if (Number.isFinite(startedAt) && startedAt >= cutoff) continue; // 还在 10 分钟内，可能真在跑
    store.update('radar_tasks', t.id, {
      last_status: 'failed',
      last_failure_reason: '上次运行未正常结束（可能 Lumos 进程被强退或崩溃）',
      updated_at: new Date().toISOString(),
    });
  }
}

function ensureRow(
  store: AppDataStore,
  desired: XRadarAutomationRow & { id: string; native_action: string },
): AppRow<XRadarAutomationRow> {
  const byAction = store
    .query<XRadarAutomationRow>('app_automations', { limit: 100 })
    .find(
      (row) =>
        (row.native_action ?? '').trim().toLowerCase() ===
        desired.native_action.trim().toLowerCase(),
    );
  const existing = byAction ?? store.get<XRadarAutomationRow>('app_automations', desired.id);
  if (!existing) {
    return store.create<XRadarAutomationRow>('app_automations', desired);
  }

  const patch: Partial<XRadarAutomationRow> = {};
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
  return store.update<XRadarAutomationRow>('app_automations', existing.id, patch) ?? existing;
}
