import type { AppDataStore, AppRow } from './runtime/data-store';

export const GOOFISH_SYNC_AUTOMATION_ID = 'goofish-sync';
export const GOOFISH_AUTO_REPLY_AUTOMATION_ID = 'goofish-auto-reply-scan';
export const GOOFISH_REMINDER_AUTOMATION_ID = 'goofish-check-reminders';
export const GOOFISH_REMINDER_AUTOMATION_ACTION = 'goofish:check-reminders';
export const GOOFISH_REMINDER_AUTOMATION_SCHEDULE = '每 5 分钟';

export interface GoofishAutomationRow extends Record<string, unknown> {
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

export function ensureGoofishDefaultAutomations(store: AppDataStore): void {
  for (const row of GOOFISH_DEFAULT_AUTOMATIONS) {
    ensureGoofishAutomation(store, row);
  }
}

export function ensureGoofishReminderAutomation(
  store: AppDataStore,
  opts: { enabled?: boolean } = {},
): AppRow<GoofishAutomationRow> {
  const desired = {
    ...GOOFISH_DEFAULT_AUTOMATIONS.find(
      (row) => row.native_action === GOOFISH_REMINDER_AUTOMATION_ACTION,
    )!,
  };
  if (typeof opts.enabled === 'boolean') desired.enabled = opts.enabled;
  const row = ensureGoofishAutomation(store, desired);
  if (typeof opts.enabled === 'boolean' && row.enabled !== opts.enabled) {
    return store.update<GoofishAutomationRow>('app_automations', row.id, {
      enabled: opts.enabled,
    }) ?? row;
  }
  return row;
}

export function findGoofishAutomationByAction(
  store: AppDataStore,
  action: string,
): AppRow<GoofishAutomationRow> | null {
  const normalized = action.trim().toLowerCase();
  return store
    .query<GoofishAutomationRow>('app_automations', { limit: 100 })
    .find((row) => (row.native_action ?? '').trim().toLowerCase() === normalized)
    ?? null;
}

function ensureGoofishAutomation(
  store: AppDataStore,
  desired: GoofishAutomationRow & { id: string; native_action: string },
): AppRow<GoofishAutomationRow> {
  const byAction = findGoofishAutomationByAction(store, desired.native_action);
  const existing = byAction ?? store.get<GoofishAutomationRow>('app_automations', desired.id);
  if (!existing) {
    return store.create<GoofishAutomationRow>('app_automations', desired);
  }

  const patch: Partial<GoofishAutomationRow> = {};
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
  return store.update<GoofishAutomationRow>('app_automations', existing.id, patch) ?? existing;
}

const GOOFISH_DEFAULT_AUTOMATIONS: Array<
  GoofishAutomationRow & { id: string; native_action: string }
> = [
  {
    id: GOOFISH_SYNC_AUTOMATION_ID,
    title: '同步闲鱼数据',
    enabled: true,
    schedule: '每 2 小时',
    native_action: 'goofish:sync',
    description: '通过 Lumos 受控闲鱼集成同步账号、买家会话和商品只读上下文。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary: '可点击「立即运行」执行一次同步；点击「同步定时」后会注册为 Lumos 定时任务。',
  },
  {
    id: GOOFISH_AUTO_REPLY_AUTOMATION_ID,
    title: '白名单自动回复扫描',
    enabled: false,
    schedule: '每 1 分钟',
    native_action: 'goofish:auto-reply-scan',
    description: '扫描新买家消息：命中已 active 白名单且通过频控的自动回复，否则生成草稿待确认。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary: '默认禁用。开启前请先在白名单话术页审核启用至少一条规则。',
  },
  {
    id: GOOFISH_REMINDER_AUTOMATION_ID,
    title: '提醒规则检查',
    enabled: false,
    schedule: GOOFISH_REMINDER_AUTOMATION_SCHEDULE,
    native_action: GOOFISH_REMINDER_AUTOMATION_ACTION,
    description: '按已启用的提醒规则检查：新消息 / 回复超时 / 关键词命中 / 草稿堆积，命中后写入应用通知中心和（可选）微信通道。',
    last_status: 'idle',
    schedule_status: 'not_connected',
    schedule_error: '',
    next_run_at: null,
    last_run_summary: '默认禁用。开启并同步后会按每 5 分钟扫描一次提醒规则。',
  },
];
