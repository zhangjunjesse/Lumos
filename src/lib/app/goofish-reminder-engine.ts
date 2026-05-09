import type Database from 'better-sqlite3';

import { withLock } from '@/lib/async-lock';
import { getDefaultUserImTarget } from './im-bridge';
import { sendAppImNotification } from './im-notifications';
import type { AppManifest } from './manifest/types';
import type { AppDataStore, AppRow } from './runtime/data-store';
import {
  buildTargetLabel,
  collectDraftBacklogCandidates,
  collectKeywordHitCandidates,
  collectNewMessageCandidates,
  collectReplyTimeoutCandidates,
  errorMessage,
  isInCooldown,
  isKeywordAlertInCooldown,
  parseChannels,
  severityToImSeverity,
  titleFromRuleType,
  writeKeywordAlert,
  type ReminderCandidate,
  type ReminderChannel,
  type ReminderRuleRow,
  type ReminderRuleType,
  type ReminderSeverity,
} from './goofish-reminder-engine-helpers';

export type { KeywordAlertRow, ReminderChannel, ReminderRuleRow, ReminderRuleType, ReminderSeverity } from './goofish-reminder-engine-helpers';

export interface ReminderScanInput {
  store: AppDataStore;
  manifest: AppManifest;
  accountId?: string;
  now?: number;
  db?: Database.Database;
  appId?: string;
}

export interface ReminderEvent {
  ruleId: string;
  ruleType: ReminderRuleType;
  conversationId?: string;
  message: string;
  severity: ReminderSeverity;
  channels: ReminderChannel[];
  notificationId?: string;
}

export interface ReminderScanResult {
  triggered: ReminderEvent[];
  skipped: number;
  errors: Array<{ ruleId: string; reason: string }>;
  runId: string;
}

const SCAN_TIMEOUT_MS = 20_000;
const MAX_EVENTS_PER_SCAN = 50;

export async function scanAndNotify(
  input: ReminderScanInput,
): Promise<ReminderScanResult> {
  // Serialize per app: a manual-trigger and the cron worker can both fire at
  // the same moment. processRule() reads `last_triggered_at` for cooldown and
  // writes it after dispatch — without the lock both passes the cooldown
  // check and the same reminder is sent twice. Lock key is the app manifest
  // id so cross-app scans stay parallel.
  const lockKey = `goofish-reminder:${input.manifest.id}`;
  return withLock(lockKey, () => doScanAndNotify(input));
}

async function doScanAndNotify(
  input: ReminderScanInput,
): Promise<ReminderScanResult> {
  const now = input.now ?? Date.now();
  const deadline = now + SCAN_TIMEOUT_MS;
  const ts = new Date(now).toISOString();
  const runRow = input.store.create('run_history', {
    title: '提醒规则扫描',
    status: 'running',
    summary: '扫描中…',
    updated_at: ts,
  });
  const result: ReminderScanResult = {
    triggered: [],
    skipped: 0,
    errors: [],
    runId: runRow.id,
  };
  const rules = loadEnabledRules(input.store);

  for (const rule of rules) {
    if (Date.now() >= deadline) break;
    if (result.triggered.length >= MAX_EVENTS_PER_SCAN) break;
    try {
      await processRule({ rule, input, now, deadline, result });
    } catch (err) {
      result.errors.push({ ruleId: rule.id, reason: errorMessage(err) });
    }
  }

  const allFailed = result.triggered.length === 0 && result.errors.length > 0;
  const summary = `提醒扫描：触发 ${result.triggered.length}，跳过 ${result.skipped}${result.errors.length ? `，错误 ${result.errors.length}` : ''}。`;
  input.store.update('run_history', runRow.id, {
    status: allFailed ? 'failed' : 'success',
    summary,
    failure_reason: result.errors.map((e) => `${e.ruleId}: ${e.reason}`).join('; ') || undefined,
    updated_at: new Date(Date.now()).toISOString(),
  });

  return result;
}

async function processRule(args: {
  rule: AppRow<ReminderRuleRow>;
  input: ReminderScanInput;
  now: number;
  deadline: number;
  result: ReminderScanResult;
}): Promise<void> {
  const { rule, input, now, deadline, result } = args;
  const ruleType = rule.rule_type;
  if (!ruleType) {
    result.errors.push({ ruleId: rule.id, reason: '缺少 rule_type 字段' });
    return;
  }
  if (isInCooldown(rule, now)) {
    result.skipped += 1;
    return;
  }
  const channels = parseChannels(rule.channels);
  if (channels.length === 0) {
    result.errors.push({ ruleId: rule.id, reason: '未声明任何提醒通道' });
    return;
  }

  const candidates = collectCandidates({ rule, input, now });
  if (candidates.length === 0) return;

  const triggeredCount = await dispatchCandidates({
    rule,
    ruleType,
    channels,
    candidates,
    input,
    now,
    deadline,
    result,
  });
  if (triggeredCount > 0) {
    const ts = new Date(now).toISOString();
    input.store.update<ReminderRuleRow>('reminder_rules', rule.id, {
      last_triggered_at: ts,
      updated_at: ts,
    });
  }
}

async function dispatchCandidates(args: {
  rule: AppRow<ReminderRuleRow>;
  ruleType: ReminderRuleType;
  channels: ReminderChannel[];
  candidates: ReminderCandidate[];
  input: ReminderScanInput;
  now: number;
  deadline: number;
  result: ReminderScanResult;
}): Promise<number> {
  const { rule, ruleType, channels, candidates, input, now, deadline, result } = args;
  let count = 0;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    if (result.triggered.length >= MAX_EVENTS_PER_SCAN) break;
    if (
      ruleType === 'keyword_hit'
      && isKeywordAlertInCooldown(input.store, candidate, rule, now)
    ) {
      result.skipped += 1;
      continue;
    }
    const event: ReminderEvent = {
      ruleId: rule.id,
      ruleType,
      conversationId: candidate.conversationId,
      message: candidate.message,
      severity: candidate.severity,
      channels,
    };
    await dispatchChannels({ event, input, now, result });
    if (ruleType === 'keyword_hit') {
      writeKeywordAlert(input.store, candidate, now);
    }
    result.triggered.push(event);
    count += 1;
  }
  return count;
}

function collectCandidates(args: {
  rule: AppRow<ReminderRuleRow>;
  input: ReminderScanInput;
  now: number;
}): ReminderCandidate[] {
  const { rule, input, now } = args;
  switch (rule.rule_type) {
    case 'new_message':
      return collectNewMessageCandidates(input.store, input.accountId);
    case 'reply_timeout':
      return collectReplyTimeoutCandidates({
        store: input.store,
        accountId: input.accountId,
        rule,
        now,
      });
    case 'keyword_hit':
      return collectKeywordHitCandidates({
        store: input.store,
        accountId: input.accountId,
        rule,
        now,
      });
    case 'draft_backlog':
      return collectDraftBacklogCandidates({ store: input.store, rule });
    default:
      return [];
  }
}

async function dispatchChannels(args: {
  event: ReminderEvent;
  input: ReminderScanInput;
  now: number;
  result: ReminderScanResult;
}): Promise<void> {
  const { event, input, now, result } = args;
  const wantsWechat = event.channels.includes('wechat');
  const notificationRow = createNotificationRow({
    store: input.store,
    event,
    wantsWechat,
    now,
  });
  event.notificationId = notificationRow.id;
  if (!wantsWechat) return;
  const guardError = checkWechatGuards(input);
  if (guardError) {
    markNotificationFailed(input.store, notificationRow.id, guardError, now);
    result.errors.push({ ruleId: event.ruleId, reason: guardError });
    return;
  }
  await sendWechatChannel({ event, input, notificationRow, now, result });
}

async function sendWechatChannel(args: {
  event: ReminderEvent;
  input: ReminderScanInput;
  notificationRow: AppRow<Record<string, unknown>>;
  now: number;
  result: ReminderScanResult;
}): Promise<void> {
  const { event, input, notificationRow, now, result } = args;
  try {
    const sendResult = await sendAppImNotification({
      db: input.db!,
      appId: input.appId!,
      notificationId: notificationRow.id,
      title: titleFromRuleType(event.ruleType),
      text: event.message,
      severity: severityToImSeverity(event.severity),
      reason: `规则 ${event.ruleId} (${event.ruleType}) 触发`,
    });
    if (!sendResult.ok) {
      result.errors.push({
        ruleId: event.ruleId,
        reason: sendResult.error || '微信通知发送失败',
      });
    }
  } catch (err) {
    const reason = errorMessage(err);
    markNotificationFailed(input.store, notificationRow.id, reason, now);
    result.errors.push({ ruleId: event.ruleId, reason });
  }
}

function markNotificationFailed(
  store: AppDataStore,
  id: string,
  reason: string,
  now: number,
): void {
  store.update('app_notifications', id, {
    status: 'failed',
    last_error: reason,
    updated_at: new Date(now).toISOString(),
  });
}

function checkWechatGuards(input: ReminderScanInput): string | null {
  if (!input.db || !input.appId) {
    return '缺少 db/appId，无法分发到微信通道';
  }
  if (!getDefaultUserImTarget(input.db)) {
    return 'IM 桥未连通：用户尚未在微信里给 Lumos/Clawbot 发过消息完成绑定。';
  }
  return null;
}

function createNotificationRow(args: {
  store: AppDataStore;
  event: ReminderEvent;
  wantsWechat: boolean;
  now: number;
}): AppRow<Record<string, unknown>> {
  return args.store.create('app_notifications', {
    channel: args.wantsWechat ? 'wechat_im' : 'system',
    provider_id: args.wantsWechat ? 'wechat' : '',
    chat_id: '',
    target_label: buildTargetLabel(args.event.channels),
    title: titleFromRuleType(args.event.ruleType),
    text: args.event.message,
    status: 'ready',
    last_error: '',
    updated_at: new Date(args.now).toISOString(),
  });
}

function loadEnabledRules(store: AppDataStore): AppRow<ReminderRuleRow>[] {
  return store
    .query<ReminderRuleRow>('reminder_rules', { limit: 100 })
    .filter((row) => row.enabled === true);
}
