/**
 * Etsy AI 出图默认行注入 — 仿 ensureXRadarDefaultAutomations。
 * 安装/升级后调，把应用必须的 app_automations / app_command_runs / app_settings 默认行 upsert 进去。
 * 同时做启动期僵尸状态恢复（崩溃留下的 running 批次 → failed）。
 */
import type { AppDataStore, AppRow } from './runtime/data-store';

export const ETSY_FORGE_REFRESH_AUTOMATION_ID = 'etsy-forge-automation-refresh-signals';

interface EtsyForgeAutomationRow extends Record<string, unknown> {
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

const AUTOMATION_DEFAULTS: Array<EtsyForgeAutomationRow & { id: string; native_action: string }> = [
  {
    id: ETSY_FORGE_REFRESH_AUTOMATION_ID,
    title: '趋势数据周更巡更',
    enabled: false,
    schedule: '每周一 03:00',
    native_action: 'etsy-forge:refresh-weekly-signals',
    description:
      '跑一次 EHunt + eRank 抓取，合成 etsy_forge_weekly_signals（rising_themes / color_trends / composition_trends / category_trends）。过期 7 天时仍可用但 status 标 stale；推送层 fallback evergreen 主题不会让应用空跑。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary:
      '默认禁用。开启前请确认 EHunt 桥 + eRank AdsPower profile 可用；首次运行会消耗 EHunt / eRank 配额。',
  },
];

interface EtsyForgeCommandRow extends Record<string, unknown> {
  command?: string;
  risk_level?: 'read' | 'low_write' | 'high_risk';
  confirmation_required?: boolean;
  status?: 'not_connected' | 'draft' | 'pending_confirmation' | 'success' | 'failed' | 'rejected';
  result_summary?: string;
  failure_reason?: string;
  last_run_id?: string;
}

const COMMAND_DEFAULTS: Array<EtsyForgeCommandRow & { id: string; command: string }> = [
  {
    id: 'etsy-forge-cmd-status',
    command: '/etsy-forge status',
    risk_level: 'read',
    confirmation_required: false,
    status: 'draft',
    result_summary:
      '查看应用就绪状态、图片服务商、配额、趋势数据新鲜度；外部微信也可发 /app Etsy AI 出图 status 查询。',
  },
  {
    id: 'etsy-forge-cmd-runs',
    command: '/etsy-forge runs',
    risk_level: 'read',
    confirmation_required: false,
    status: 'draft',
    result_summary: '查看最近 10 批刷图记录：推送方向、生成/收藏数、配额消耗、失败原因。',
  },
  {
    id: 'etsy-forge-cmd-library',
    command: '/etsy-forge library',
    risk_level: 'read',
    confirmation_required: false,
    status: 'draft',
    result_summary: '查看图库总图数、原图/二创占比、最近收藏的图缩略图。',
  },
  {
    id: 'etsy-forge-cmd-quota',
    command: '/etsy-forge quota',
    risk_level: 'read',
    confirmation_required: false,
    status: 'draft',
    result_summary: '查看云端剩余配额（整数，500000 = ¥1）和充值入口链接。',
  },
];

const APP_SETTINGS_DEFAULT_ID = 'etsy-forge-default-settings';

const APP_SETTINGS_DEFAULT: Record<string, unknown> = {
  ai_system_prompt:
    'Generate ORIGINAL Etsy POD designs only. Strictly avoid copyrighted characters, brands, celebrities, and trademarked logos. Optimize for print: clean edges, high contrast, transparent or simple background. No melting faces, extra fingers, random text, signatures, or watermarks. Single focal subject works at both T-shirt-pocket and poster scale.',
  risk_note:
    '不爬同行图、不做他人图的二创、不自动上架到 Etsy。导出/上架时按 Etsy 2024 新规自动标 AI 生成（不标会被封店）。清空图库 / 重置审美档案 / 重新拉取趋势数据需二次确认。',
  batch_size: 50,
  prefetch_at_index: 30,
  concurrency_per_batch: 5,
  min_signals_for_main_strategy: 50,
  min_signals_for_mixed_strategy: 10,
  dedup_cosine_threshold: 0.85,
  auto_tag_ai_generated: true,
};

export function ensureEtsyForgeDefaultAutomations(store: AppDataStore): void {
  for (const row of AUTOMATION_DEFAULTS) ensureAutomationRow(store, row);
  for (const row of COMMAND_DEFAULTS) ensureCommandRow(store, row);
  ensureDefaultSettings(store);
  recoverStaleRunningBatches(store);
}

function ensureAutomationRow(
  store: AppDataStore,
  desired: EtsyForgeAutomationRow & { id: string; native_action: string },
): AppRow<EtsyForgeAutomationRow> {
  const byAction = store
    .query<EtsyForgeAutomationRow>('app_automations', { limit: 100 })
    .find(
      (r) =>
        (r.native_action ?? '').trim().toLowerCase() ===
        desired.native_action.trim().toLowerCase(),
    );
  const existing = byAction ?? store.get<EtsyForgeAutomationRow>('app_automations', desired.id);
  if (!existing) return store.create<EtsyForgeAutomationRow>('app_automations', desired);
  return existing;
}

function ensureCommandRow(
  store: AppDataStore,
  desired: EtsyForgeCommandRow & { id: string; command: string },
): AppRow<EtsyForgeCommandRow> {
  const byCommand = store
    .query<EtsyForgeCommandRow>('app_command_runs', { limit: 100 })
    .find((r) => (r.command ?? '').trim() === desired.command.trim());
  const existing = byCommand ?? store.get<EtsyForgeCommandRow>('app_command_runs', desired.id);
  if (!existing) return store.create<EtsyForgeCommandRow>('app_command_runs', desired);
  return existing;
}

function ensureDefaultSettings(store: AppDataStore): void {
  const existing = store.query<Record<string, unknown>>('app_settings', { limit: 1 })[0];
  if (existing) return;
  store.create('app_settings', { id: APP_SETTINGS_DEFAULT_ID, ...APP_SETTINGS_DEFAULT });
}

/**
 * 启动期僵尸恢复：进程崩溃 / OS kill / 强退后 etsy_forge_runs 残留 status='running'。
 * 把 10 分钟前还 running 的标记为 failed。
 */
function recoverStaleRunningBatches(store: AppDataStore): void {
  const cutoff = Date.now() - 10 * 60_000;
  const runs = store.query<{ id: string; status?: string; started_at?: string }>(
    'etsy_forge_runs',
    { limit: 500 },
  );
  for (const r of runs) {
    if (r.status !== 'running') continue;
    const startedAt = r.started_at ? Date.parse(r.started_at) : NaN;
    if (Number.isFinite(startedAt) && startedAt >= cutoff) continue;
    store.update('etsy_forge_runs', r.id, {
      status: 'failed',
      failure_reason: '上次运行未正常结束（可能 Lumos 进程被强退或崩溃）',
      ended_at: new Date().toISOString(),
    });
  }
}
