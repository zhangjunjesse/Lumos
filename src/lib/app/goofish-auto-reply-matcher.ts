import { sendMessage as sendGoofishMessage } from '@/lib/goofish/messages';
import { withLock } from '@/lib/async-lock';
import { generateGoofishReplyDraft } from './goofish-reply-draft-generator';
import { isGoofishNativeApp } from './goofish-app-sync';
import type { AppManifest } from './manifest/types';
import type { AppDataStore, AppRow } from './runtime/data-store';

export interface AutoReplyScanInput {
  store: AppDataStore;
  manifest: AppManifest;
  accountId?: string;
  now?: number;
  deps?: Partial<AutoReplyScanDeps>;
}

export interface AutoReplyScanResult {
  ok: boolean;
  runId: string;
  matched: number;
  sent: number;
  drafted: number;
  throttled: number;
  errors: Array<{ conversationId: string; reason: string }>;
}

export interface AutoReplyScanDeps {
  now: () => number;
  sendMessage: (cid: string, toid: string, text: string) => Promise<void>;
  generateDraft: (input: {
    manifest: AppManifest;
    store: AppDataStore;
    rowId: string;
  }) => Promise<{ ok: boolean; message?: string }>;
}

// Sentinel marking drafts written by this whitelist auto-reply path.
export const WHITELIST_AUTO_CHANNEL = 'whitelist_auto';

const SCAN_TIMEOUT_MS = 30_000;
const PER_BUYER_WINDOW_MS = 5 * 60 * 1000;
const PER_ACCOUNT_WINDOW_MS = 60 * 1000;
const PER_ACCOUNT_LIMIT = 10;
const PER_BUYER_LIMIT = 1;
const THROTTLE_PROBE_LIMIT = 64;

interface AutoReplyRuleRow extends Record<string, unknown> {
  trigger_pattern?: string;
  trigger_type?: 'keyword' | 'regex';
  reply_template?: string;
  category?: string;
  enabled?: boolean;
  status?: 'pending' | 'active';
  match_count?: number;
  last_matched_at?: string | null;
}
interface BuyerConversationRow extends Record<string, unknown> {
  conversation_id?: string;
  account_unb?: string;
  buyer_name?: string;
  buyer_user_id?: string;
  item_title?: string;
  last_message?: string;
  reply_status?: '待回复' | '已草稿' | '待确认' | '已回复' | '忽略';
}
interface ReplyDraftRow extends Record<string, unknown> {
  conversation_id?: string;
  buyer_name?: string;
  item_title?: string;
  incoming_message?: string;
  draft_text?: string;
  status?: 'draft' | 'pending_confirmation' | 'sent' | 'failed' | 'rejected';
  confirmation_channel?: string;
  matched_rule_id?: string;
  failure_reason?: string;
  risk_note?: string;
  updated_at?: string;
}
interface ProcessContext {
  store: AppDataStore; manifest: AppManifest; deps: AutoReplyScanDeps;
  conversation: AppRow<BuyerConversationRow>; rules: AppRow<AutoReplyRuleRow>[];
  now: number; updatedAt: string; result: AutoReplyScanResult;
}

const defaultDeps: AutoReplyScanDeps = {
  now: () => Date.now(),
  sendMessage: sendGoofishMessage,
  generateDraft: (input) =>
    generateGoofishReplyDraft({ manifest: input.manifest, store: input.store, rowId: input.rowId }),
};

export async function scanAndReply(input: AutoReplyScanInput): Promise<AutoReplyScanResult> {
  if (!isGoofishNativeApp(input.manifest)) {
    throw new Error('当前应用未声明为闲鱼类应用，不能调用白名单自动回复扫描。');
  }
  // Serialize per app: a manual-trigger API call and the scheduled cron worker
  // can both call us at the same moment. Without the lock, both pass the
  // checkThrottle() probe before either's draft lands as 'sent', and the
  // PER_ACCOUNT_LIMIT/PER_BUYER_LIMIT can be exceeded by 2x. Lock key is the
  // app manifest id so different apps (or future per-account splits) still run
  // independently.
  return withLock(`goofish-auto-reply:${input.manifest.id}`, () => doScanAndReply(input));
}

async function doScanAndReply(input: AutoReplyScanInput): Promise<AutoReplyScanResult> {
  const deps: AutoReplyScanDeps = { ...defaultDeps, ...(input.deps ?? {}) };
  const now = input.now ?? deps.now();
  const updatedAt = new Date(now).toISOString();
  const result: AutoReplyScanResult = {
    ok: true, runId: '', matched: 0, sent: 0, drafted: 0, throttled: 0, errors: [],
  };

  // Honor the user-controlled global kill switch from app_settings. UI writes
  // `auto_reply_global_enabled` from AutoReplyTab; default is enabled when
  // unset. When disabled, we still write a run_history row so the run is
  // visible and auditable but skip all scanning.
  const settingsRows = input.store.query<{ auto_reply_global_enabled?: boolean }>(
    'app_settings',
    { limit: 1 },
  );
  const globalEnabled = settingsRows[0]?.auto_reply_global_enabled !== false;
  if (!globalEnabled) {
    const skipRun = input.store.create('run_history', {
      title: '扫描白名单自动回复',
      status: 'success',
      summary: '总开关已关闭，跳过本次扫描。',
      updated_at: updatedAt,
    });
    result.runId = skipRun.id;
    return result;
  }

  const run = input.store.create('run_history', {
    title: '扫描白名单自动回复',
    status: 'running',
    summary: '正在按白名单话术扫描待回复买家会话；命中后受频控约束。',
    updated_at: updatedAt,
  });
  result.runId = run.id;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const rules = input.store.query<AutoReplyRuleRow>('auto_reply_rules', {
      filter: { enabled: true, status: 'active' }, limit: 200,
    });
    const convFilter: Record<string, unknown> = { reply_status: '待回复' };
    if (input.accountId) convFilter.account_unb = input.accountId;
    const conversations = input.store.query<BuyerConversationRow>('buyer_conversations', {
      filter: convFilter, limit: 200,
    });
    for (const conversation of conversations) {
      if (controller.signal.aborted) break;
      await processConversation({
        store: input.store, manifest: input.manifest, deps,
        conversation, rules, now, updatedAt, result,
      });
    }
  } catch (error) {
    result.ok = false;
    result.errors.push({ conversationId: '', reason: errorMessage(error) });
  } finally {
    clearTimeout(timeoutHandle);
  }
  finalizeRun(input.store, run.id, result, updatedAt, controller.signal.aborted);
  return result;
}

async function processConversation(ctx: ProcessContext): Promise<void> {
  const message = textValue(ctx.conversation.last_message);
  const conversationId = textValue(ctx.conversation.conversation_id);
  if (!message || !conversationId) return;
  const matched = matchRule(message, ctx.rules);
  if (!matched) {
    await fallbackToDraft(ctx, '未命中白名单话术');
    return;
  }
  ctx.result.matched += 1;
  bumpRuleStats(ctx.store, matched, ctx.now, ctx.updatedAt);
  const throttle = checkThrottle(ctx.store, conversationId, ctx.now);
  if (throttle) {
    ctx.result.throttled += 1;
    await fallbackToDraft(ctx, throttle);
    return;
  }
  await dispatchSend(ctx, matched, message);
}

function matchRule(
  message: string,
  rules: AppRow<AutoReplyRuleRow>[],
): AppRow<AutoReplyRuleRow> | null {
  const lower = message.toLowerCase();
  for (const rule of rules) {
    const pattern = textValue(rule.trigger_pattern);
    if (!pattern) continue;
    if (rule.trigger_type === 'regex') {
      try {
        if (new RegExp(pattern, 'i').test(message)) return rule;
      } catch {
        // Invalid regex — silently skip; rule author will see no matches.
      }
    } else if (lower.includes(pattern.toLowerCase())) {
      return rule;
    }
  }
  return null;
}

function checkThrottle(
  store: AppDataStore,
  conversationId: string,
  now: number,
): string | null {
  const recent = store.query<ReplyDraftRow>('reply_drafts', {
    filter: { confirmation_channel: WHITELIST_AUTO_CHANNEL, status: 'sent' },
    limit: THROTTLE_PROBE_LIMIT,
  });
  let perBuyer = 0;
  let perAccount = 0;
  for (const draft of recent) {
    const ts = Date.parse(textValue(draft.updated_at));
    if (!Number.isFinite(ts)) continue;
    const age = now - ts;
    if (age <= PER_ACCOUNT_WINDOW_MS) perAccount += 1;
    if (textValue(draft.conversation_id) === conversationId && age <= PER_BUYER_WINDOW_MS) perBuyer += 1;
  }
  if (perBuyer >= PER_BUYER_LIMIT) return '单买家 5 分钟内已发过自动回复，本轮降级为草稿。';
  if (perAccount >= PER_ACCOUNT_LIMIT) return '账号 1 分钟内已发出 10 条自动回复，本轮降级为草稿。';
  return null;
}

async function dispatchSend(
  ctx: ProcessContext,
  rule: AppRow<AutoReplyRuleRow>,
  incoming: string,
): Promise<void> {
  const conversationId = textValue(ctx.conversation.conversation_id);
  const buyerUserId = textValue(ctx.conversation.buyer_user_id);
  const draftText = textValue(rule.reply_template);
  if (!buyerUserId || !draftText) {
    await fallbackToDraft(ctx, '命中规则但缺少买家 ID 或回复模板，降级为草稿。');
    return;
  }
  try {
    await ctx.deps.sendMessage(conversationId, buyerUserId, draftText);
  } catch (error) {
    const reason = errorMessage(error);
    ctx.result.errors.push({ conversationId, reason });
    await fallbackToDraft(ctx, `自动发送失败：${reason}`);
    return;
  }
  ctx.store.create<ReplyDraftRow>('reply_drafts', {
    conversation_id: conversationId,
    buyer_name: textValue(ctx.conversation.buyer_name),
    item_title: textValue(ctx.conversation.item_title),
    incoming_message: incoming,
    draft_text: draftText,
    status: 'sent',
    confirmation_channel: WHITELIST_AUTO_CHANNEL,
    matched_rule_id: rule.id,
    failure_reason: '',
    risk_note: `白名单分类「${textValue(rule.category) || '未分类'}」自动回复。`,
    updated_at: ctx.updatedAt,
  });
  ctx.store.update<BuyerConversationRow & { updated_at?: string }>('buyer_conversations', ctx.conversation.id, {
    reply_status: '已回复',
    updated_at: ctx.updatedAt,
  });
  ctx.result.sent += 1;
}

async function fallbackToDraft(ctx: ProcessContext, reason: string): Promise<void> {
  const conversationId = textValue(ctx.conversation.conversation_id);
  try {
    const ret = await ctx.deps.generateDraft({
      manifest: ctx.manifest, store: ctx.store, rowId: ctx.conversation.id,
    });
    if (ret.ok) ctx.result.drafted += 1;
    else ctx.result.errors.push({ conversationId, reason: ret.message || reason });
  } catch (error) {
    ctx.result.errors.push({ conversationId, reason: errorMessage(error) });
  }
}

function bumpRuleStats(
  store: AppDataStore,
  rule: AppRow<AutoReplyRuleRow>,
  now: number,
  updatedAt: string,
): void {
  const prev = Number(rule.match_count ?? 0) || 0;
  store.update<AutoReplyRuleRow & { updated_at?: string }>('auto_reply_rules', rule.id, {
    match_count: prev + 1,
    last_matched_at: new Date(now).toISOString(),
    updated_at: updatedAt,
  });
}

function finalizeRun(
  store: AppDataStore,
  runId: string,
  result: AutoReplyScanResult,
  updatedAt: string,
  aborted: boolean,
): void {
  const stats = `matched=${result.matched} sent=${result.sent} drafted=${result.drafted} throttled=${result.throttled} errors=${result.errors.length}`;
  const summary = aborted
    ? `扫描超过 ${SCAN_TIMEOUT_MS / 1000} 秒被强制结束；${stats}`
    : `白名单扫描完成：${stats}`;
  const failureReason = aborted || result.errors.length > 0
    ? result.errors.map((entry) => entry.reason).filter(Boolean).join('；') || (aborted ? '扫描超时' : '')
    : '';
  store.update('run_history', runId, {
    status: aborted ? 'failed' : 'success',
    summary,
    failure_reason: failureReason,
    updated_at: updatedAt,
  });
  if (aborted) result.ok = false;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
