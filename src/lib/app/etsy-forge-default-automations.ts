/**
 * Etsy 选品采集 默认行注入 — 仿 ensureXRadarDefaultAutomations。
 * 安装/升级后调：注入「关键词采集巡更」自动化 + IM 命令 + 默认设置；启动期僵尸恢复。
 * 不预置关键词任务（任务由用户输入关键词创建）。
 */
import type { AppDataStore, AppRow } from './runtime/data-store';

export const ETSY_FORGE_COLLECTION_AUTOMATION_ID = 'etsy-forge-automation-run-collection-tasks';

interface AutomationRow extends Record<string, unknown> {
  title?: string;
  enabled?: boolean;
  schedule?: string;
  native_action?: string;
  description?: string;
  last_status?: 'not_connected' | 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  last_run_summary?: string;
  schedule_status?: 'not_connected' | 'scheduled' | 'paused' | 'failed';
  schedule_error?: string;
  next_run_at?: string | null;
}

const AUTOMATION_DEFAULTS: Array<AutomationRow & { id: string; native_action: string }> = [
  {
    id: ETSY_FORGE_COLLECTION_AUTOMATION_ID,
    title: '关键词采集巡更',
    enabled: false,
    schedule: '每天 03:00',
    native_action: 'etsy-forge:run-collection-tasks',
    description:
      '扫所有 enabled 的关键词任务，按 schedule(hourly/daily/weekly)+last_run_at 到点的逐个走浏览器爬 Etsy 列表（主图+EHunt）入商品库。manual 任务不自动跑。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary: '默认禁用。开启前确认设置→采集浏览器选了 AdsPower（要 EHunt）且登录 Etsy。',
  },
];

interface CommandRow extends Record<string, unknown> {
  command?: string;
  risk_level?: 'read' | 'low_write' | 'high_risk';
  confirmation_required?: boolean;
  status?: 'not_connected' | 'draft' | 'pending_confirmation' | 'success' | 'failed' | 'rejected';
  result_summary?: string;
}

const COMMAND_DEFAULTS: Array<CommandRow & { id: string; command: string }> = [
  { id: 'etsy-forge-cmd-status', command: '/etsy-forge status', risk_level: 'read', confirmation_required: false, status: 'draft', result_summary: '查看应用状态、采集浏览器、关键词任务数、商品数。' },
  { id: 'etsy-forge-cmd-runs', command: '/etsy-forge runs', risk_level: 'read', confirmation_required: false, status: 'draft', result_summary: '查看最近列表/详情采集批次：关键词、商品数、EHunt 命中、详情图数、失败原因。' },
  { id: 'etsy-forge-cmd-products', command: '/etsy-forge products', risk_level: 'read', confirmation_required: false, status: 'draft', result_summary: '查看已采集商品数、已勾选数、已爬详情图的商品数。' },
  { id: 'etsy-forge-cmd-library', command: '/etsy-forge library', risk_level: 'read', confirmation_required: false, status: 'draft', result_summary: '查看图库详情图总数、按关键词分布。' },
];

const APP_SETTINGS_DEFAULT_ID = 'etsy-forge-default-settings';
const APP_SETTINGS_DEFAULT: Record<string, unknown> = {
  browser_context_id: 'embedded:default',
  default_max_products: 24,
  download_detail_images: false,
  ai_system_prompt: '纯爬取选品工具，不生成图片、不调图片服务商。采集图仅选品参考。',
  risk_note: '采集图仅参考不可直接上架（DMCA）；不绕过 Etsy 反爬；EHunt 抓不到如实显示不 mock。',
};

export function ensureEtsyForgeDefaultAutomations(store: AppDataStore): void {
  for (const row of AUTOMATION_DEFAULTS) ensureAutomationRow(store, row);
  for (const row of COMMAND_DEFAULTS) ensureCommandRow(store, row);
  ensureDefaultSettings(store);
  recoverStaleRunningBatches(store);
  recoverStaleRunningTasks(store);
}

function ensureAutomationRow(
  store: AppDataStore,
  desired: AutomationRow & { id: string; native_action: string },
): AppRow<AutomationRow> {
  const byAction = store
    .query<AutomationRow>('app_automations', { limit: 100 })
    .find((r) => (r.native_action ?? '').trim().toLowerCase() === desired.native_action.trim().toLowerCase());
  const existing = byAction ?? store.get<AutomationRow>('app_automations', desired.id);
  if (!existing) return store.create<AutomationRow>('app_automations', desired);
  return existing;
}

function ensureCommandRow(
  store: AppDataStore,
  desired: CommandRow & { id: string; command: string },
): AppRow<CommandRow> {
  const byCommand = store
    .query<CommandRow>('app_command_runs', { limit: 100 })
    .find((r) => (r.command ?? '').trim() === desired.command.trim());
  const existing = byCommand ?? store.get<CommandRow>('app_command_runs', desired.id);
  if (!existing) return store.create<CommandRow>('app_command_runs', desired);
  return existing;
}

function ensureDefaultSettings(store: AppDataStore): void {
  const existing = store.query<Record<string, unknown>>('app_settings', { limit: 1 })[0];
  if (existing) return;
  store.create('app_settings', { id: APP_SETTINGS_DEFAULT_ID, ...APP_SETTINGS_DEFAULT });
}

/** 启动期僵尸恢复：etsy_forge_runs 残留 running（>10min）→ failed。 */
function recoverStaleRunningBatches(store: AppDataStore): void {
  const cutoff = Date.now() - 10 * 60_000;
  const runs = store.query<{ id: string; status?: string; started_at?: string }>('etsy_forge_runs', { limit: 500 });
  for (const r of runs) {
    if (r.status !== 'running') continue;
    const t = r.started_at ? Date.parse(r.started_at) : NaN;
    if (Number.isFinite(t) && t >= cutoff) continue;
    store.update('etsy_forge_runs', r.id, {
      status: 'failed',
      failure_reason: '上次运行未正常结束（可能进程被强退）',
      ended_at: new Date().toISOString(),
    });
  }
}

/** 同上：etsy_forge_collection_tasks 残留 running → failed。 */
function recoverStaleRunningTasks(store: AppDataStore): void {
  const cutoff = Date.now() - 10 * 60_000;
  const tasks = store.query<{ id: string; last_status?: string; last_run_at?: string }>('etsy_forge_collection_tasks', { limit: 500 });
  for (const t of tasks) {
    if (t.last_status !== 'running') continue;
    const at = t.last_run_at ? Date.parse(t.last_run_at) : NaN;
    if (Number.isFinite(at) && at >= cutoff) continue;
    store.update('etsy_forge_collection_tasks', t.id, {
      last_status: 'failed',
      last_failure_reason: '上次运行未正常结束（可能进程被强退）',
    });
  }
}
