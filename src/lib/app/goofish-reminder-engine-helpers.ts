import type { AppDataStore, AppRow } from './runtime/data-store';

export type ReminderRuleType = 'new_message' | 'reply_timeout' | 'keyword_hit' | 'draft_backlog';
export type ReminderChannel = 'in_app' | 'wechat' | 'desktop';
export type ReminderSeverity = 'low' | 'medium' | 'high';
type BuyerReplyStatus = '待回复' | '已草稿' | '待确认' | '已回复' | '忽略';
type DraftStatus = 'draft' | 'pending_confirmation' | 'sent' | 'failed' | 'rejected';

export interface ReminderRuleRow extends Record<string, unknown> {
  rule_type?: ReminderRuleType;
  threshold_minutes?: number;
  threshold_count?: number;
  keywords?: string;
  channels?: string;
  enabled?: boolean;
  last_triggered_at?: string | null;
  cooldown_minutes?: number;
  updated_at?: string;
}

export interface KeywordAlertRow extends Record<string, unknown> {
  keyword?: string;
  conversation_id?: string;
  buyer_name?: string;
  message?: string;
  severity?: ReminderSeverity;
  handled?: boolean;
  handled_at?: string | null;
  created_at?: string;
}

export interface BuyerConversationRow extends Record<string, unknown> {
  conversation_id?: string;
  account_unb?: string;
  buyer_name?: string;
  buyer_user_id?: string;
  item_title?: string;
  unread_count?: number;
  last_message?: string;
  last_message_at?: string;
  reply_status?: BuyerReplyStatus;
  updated_at?: string;
}

export interface ReplyDraftRow extends Record<string, unknown> {
  conversation_id?: string;
  buyer_name?: string;
  status?: DraftStatus;
  updated_at?: string;
}

export interface ReminderCandidate {
  conversationId?: string;
  buyerName?: string;
  message: string;
  severity: ReminderSeverity;
  keyword?: string;
  rawText?: string;
}

export const KEYWORD_WINDOW_MIN_MINUTES = 60;
const ALLOWED_CHANNELS = new Set<ReminderChannel>(['in_app', 'wechat', 'desktop']);
const RULE_TITLES: Record<ReminderRuleType, string> = {
  new_message: '新消息提醒',
  reply_timeout: '回复超时提醒',
  keyword_hit: '关键词命中提醒',
  draft_backlog: '草稿堆积提醒',
};
const CHANNEL_LABELS: Record<ReminderChannel, string> = {
  in_app: '应用内',
  wechat: '微信',
  desktop: '桌面',
};

export function listConversations(
  store: AppDataStore,
  accountId: string | undefined,
): AppRow<BuyerConversationRow>[] {
  const opts = accountId
    ? { filter: { account_unb: accountId }, limit: 500 }
    : { limit: 500 };
  return store.query<BuyerConversationRow>('buyer_conversations', opts);
}

export function collectNewMessageCandidates(
  store: AppDataStore,
  accountId: string | undefined,
): ReminderCandidate[] {
  return listConversations(store, accountId)
    .filter((row) => toInt(row.unread_count) > 0)
    .map((row) => ({
      conversationId: clean(row.conversation_id),
      buyerName: clean(row.buyer_name),
      message: `买家 ${clean(row.buyer_name) || '未知'} 有 ${toInt(row.unread_count)} 条未读消息${
        row.item_title ? `（商品：${clean(row.item_title)}）` : ''
      }。`,
      severity: priorityFromUnread(toInt(row.unread_count)),
    }));
}

export function collectReplyTimeoutCandidates(args: {
  store: AppDataStore;
  accountId: string | undefined;
  rule: AppRow<ReminderRuleRow>;
  now: number;
}): ReminderCandidate[] {
  const thresholdMinutes = Math.max(0, toInt(args.rule.threshold_minutes));
  if (thresholdMinutes <= 0) return [];
  const cutoff = args.now - thresholdMinutes * 60_000;
  return listConversations(args.store, args.accountId)
    .filter((row) => row.reply_status === '待回复')
    .filter((row) => parseTime(row.last_message_at) > 0
      && parseTime(row.last_message_at) <= cutoff)
    .map((row) => ({
      conversationId: clean(row.conversation_id),
      buyerName: clean(row.buyer_name),
      message: `买家 ${clean(row.buyer_name) || '未知'} 已经等待回复超过 ${thresholdMinutes} 分钟。`,
      severity: 'high' as const,
    }));
}

export function collectKeywordHitCandidates(args: {
  store: AppDataStore;
  accountId: string | undefined;
  rule: AppRow<ReminderRuleRow>;
  now: number;
}): ReminderCandidate[] {
  const keywords = parseKeywords(args.rule.keywords);
  if (keywords.length === 0) return [];
  const windowMinutes = Math.max(
    KEYWORD_WINDOW_MIN_MINUTES,
    toInt(args.rule.threshold_minutes),
  );
  const cutoff = args.now - windowMinutes * 60_000;
  const out: ReminderCandidate[] = [];
  for (const row of listConversations(args.store, args.accountId)) {
    const text = clean(row.last_message);
    if (!text) continue;
    if (parseTime(row.last_message_at) < cutoff) continue;
    const lower = text.toLowerCase();
    const matched = keywords.find((kw) => lower.includes(kw.toLowerCase()));
    if (!matched) continue;
    out.push({
      conversationId: clean(row.conversation_id),
      buyerName: clean(row.buyer_name),
      keyword: matched,
      rawText: text,
      message: `买家 ${clean(row.buyer_name) || '未知'} 触发关键词「${matched}」：${truncate(text, 80)}`,
      severity: 'high',
    });
  }
  return out;
}

export function collectDraftBacklogCandidates(args: {
  store: AppDataStore;
  rule: AppRow<ReminderRuleRow>;
}): ReminderCandidate[] {
  const minCount = Math.max(1, toInt(args.rule.threshold_count));
  const drafts = args.store.query<ReplyDraftRow>('reply_drafts', {
    filter: { status: 'pending_confirmation' },
    limit: 200,
  });
  if (drafts.length < minCount) return [];
  return [
    {
      message: `已有 ${drafts.length} 条回复草稿等待确认（阈值 ${minCount}）。请尽快进入应用确认或驳回。`,
      severity: drafts.length >= minCount * 2 ? 'high' : 'medium',
    },
  ];
}

export function writeKeywordAlert(
  store: AppDataStore,
  candidate: ReminderCandidate,
  now: number,
): void {
  const ts = new Date(now).toISOString();
  store.create<KeywordAlertRow>('keyword_alerts', {
    keyword: candidate.keyword || '',
    conversation_id: candidate.conversationId || '',
    buyer_name: candidate.buyerName || '',
    message: candidate.rawText || candidate.message,
    severity: candidate.severity,
    handled: false,
    handled_at: null,
    created_at: ts,
    updated_at: ts,
  });
}

export function isKeywordAlertInCooldown(
  store: AppDataStore,
  candidate: ReminderCandidate,
  rule: AppRow<ReminderRuleRow>,
  now: number,
): boolean {
  if (!candidate.keyword || !candidate.conversationId) return false;
  const cooldownMin = Math.max(0, toInt(rule.cooldown_minutes));
  if (cooldownMin <= 0) return false;
  const recent = store.query<KeywordAlertRow>('keyword_alerts', {
    filter: {
      conversation_id: candidate.conversationId,
      keyword: candidate.keyword,
    },
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 1,
  });
  if (recent.length === 0) return false;
  const last = parseTime(recent[0].created_at);
  if (!last) return false;
  return now - last < cooldownMin * 60_000;
}

export function isInCooldown(rule: AppRow<ReminderRuleRow>, now: number): boolean {
  const cooldownMin = Math.max(0, toInt(rule.cooldown_minutes));
  if (cooldownMin <= 0) return false;
  const last = parseTime(rule.last_triggered_at);
  if (!last) return false;
  return now - last < cooldownMin * 60_000;
}

export function parseChannels(raw: unknown): ReminderChannel[] {
  const parsed = safeJsonArray(raw);
  if (!parsed) return [];
  const out: ReminderChannel[] = [];
  for (const value of parsed) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim().toLowerCase() as ReminderChannel;
    if (ALLOWED_CHANNELS.has(normalized) && !out.includes(normalized)) {
      out.push(normalized);
    }
  }
  return out;
}

export function parseKeywords(raw: unknown): string[] {
  const parsed = safeJsonArray(raw);
  if (!parsed) return [];
  return parsed
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function buildTargetLabel(channels: ReminderChannel[]): string {
  return channels.map((c) => CHANNEL_LABELS[c]).join(' + ') || '应用内';
}

export function titleFromRuleType(ruleType: ReminderRuleType): string {
  return RULE_TITLES[ruleType];
}

export function severityToImSeverity(s: ReminderSeverity): 'info' | 'warning' | 'error' {
  return s === 'high' ? 'error' : s === 'medium' ? 'warning' : 'info';
}

export function priorityFromUnread(count: number): ReminderSeverity {
  return count >= 5 ? 'high' : count >= 2 ? 'medium' : 'low';
}

export function parseTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return 0;
  const t = Date.parse(value.trim());
  return Number.isFinite(t) ? t : 0;
}

export function toInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== 'string') return 0;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

export const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
export const truncate = (t: string, max: number): string => (t.length <= max ? t : `${t.slice(0, max)}...`);
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function safeJsonArray(raw: unknown): unknown[] | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
