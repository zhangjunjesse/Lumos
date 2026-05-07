import type { WeChatSnapshot, WeChatSnapshotMessage } from './analysis';
import { displayWechatName, sanitizeWechatText } from './wechat-text';

/**
 * Trim a (potentially huge) WeChat snapshot down to what fits in a single LLM call.
 * Strategy:
 *   - drop system messages (10000/10002) and pure placeholders ([图片]/[语音] alone)
 *   - keep only the last `windowDays` worth of messages
 *   - per-conversation: take the last `perConvLimit` messages
 *   - cap total messages at `globalLimit`, dropping conversations that look like
 *     low-signal broadcasts first (group chats with no @ to the user, no replies)
 *
 * The output is `LlmMessage[]` — each message carries a stable `idx` so the AI
 * can reference it by id and we can later look up the real message + display.
 */
export interface LlmMessage {
  idx: number;
  ts: number;
  wxid: string;
  display: string;
  isGroup: boolean;
  sender: 'me' | 'them';
  senderWxid?: string | null;
  senderDisplay?: string | null;
  text: string;
}

export interface CroppedSnapshot {
  messages: LlmMessage[];
  totalMessagesIn: number;
  conversationsKept: number;
  conversationsDropped: number;
  windowStart: number;
  windowEnd: number;
}

const PLACEHOLDER_PATTERN = /^\s*\[[^\]]+\]\s*$/;
const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_PER_CONV_LIMIT = 80;
const DEFAULT_GLOBAL_LIMIT = 1200;

export function cropSnapshotForLlm(
  snapshot: WeChatSnapshot,
  options: { windowDays?: number; perConvLimit?: number; globalLimit?: number } = {},
): CroppedSnapshot {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const perConvLimit = options.perConvLimit ?? DEFAULT_PER_CONV_LIMIT;
  const globalLimit = options.globalLimit ?? DEFAULT_GLOBAL_LIMIT;

  const usable = snapshot.messages.filter(isUsable);
  if (usable.length === 0) {
    return {
      messages: [],
      totalMessagesIn: 0,
      conversationsKept: 0,
      conversationsDropped: 0,
      windowStart: 0,
      windowEnd: 0,
    };
  }

  const latestTs = Math.max(...usable.map((m) => m.ts));
  const windowStart = latestTs - windowDays * 24 * 60 * 60;
  const inWindow = usable.filter((m) => m.ts >= windowStart);

  const byConv = new Map<string, WeChatSnapshotMessage[]>();
  for (const msg of inWindow) {
    const arr = byConv.get(msg.wxid) ?? [];
    arr.push(msg);
    byConv.set(msg.wxid, arr);
  }

  const ranked = Array.from(byConv.entries())
    .map(([wxid, list]) => ({
      wxid,
      list,
      score: scoreConversation(list),
    }))
    .sort((a, b) => b.score - a.score);

  const out: LlmMessage[] = [];
  let kept = 0;
  let idx = 0;
  for (const conv of ranked) {
    if (out.length >= globalLimit) break;
    const tail = conv.list
      .slice()
      .sort((a, b) => a.ts - b.ts)
      .slice(-perConvLimit);
    if (tail.length === 0) continue;
    kept += 1;
    for (const msg of tail) {
      if (out.length >= globalLimit) break;
      out.push({
        idx,
        ts: msg.ts,
        wxid: msg.wxid,
        display: cleanDisplayName(msg.display, msg.wxid, msg.isGroup),
        isGroup: msg.isGroup,
        sender: msg.sender,
        senderWxid: msg.senderWxid ?? null,
        senderDisplay: msg.senderDisplay
          ? cleanSenderDisplay(msg.senderDisplay, msg.senderWxid ?? '')
          : null,
        text: cleanText(msg.content),
      });
      idx += 1;
    }
  }

  return {
    messages: out,
    totalMessagesIn: usable.length,
    conversationsKept: kept,
    conversationsDropped: ranked.length - kept,
    windowStart,
    windowEnd: latestTs,
  };
}

function isUsable(msg: WeChatSnapshotMessage): boolean {
  if (msg.type === 10000 || msg.type === 10002) return false;
  const trimmed = cleanText(msg.content);
  if (!trimmed) return false;
  if (PLACEHOLDER_PATTERN.test(trimmed)) return false;
  return true;
}

/**
 * Higher score = more likely to contain real signal.
 * - direct messages > group messages
 * - presence of any user-sent reply > one-way broadcast
 * - any question marks / common-task verbs in last 7 days bumps score
 */
function scoreConversation(list: WeChatSnapshotMessage[]): number {
  if (list.length === 0) return 0;
  const isGroup = list[0].isGroup;
  let score = isGroup ? 5 : 30;
  const yourCount = list.filter((m) => m.sender === 'me').length;
  if (yourCount > 0) score += 15;
  if (yourCount >= 3) score += 10;
  const recentCutoff = Math.max(...list.map((m) => m.ts)) - 7 * 24 * 60 * 60;
  for (const msg of list) {
    if (msg.ts < recentCutoff) continue;
    if (/[?？吗呢么]/.test(msg.content)) {
      score += 0.3;
    }
    if (/(麻烦|帮我|帮忙|确认|回复|发给|发我|尽快|今天|明天|周[一二三四五六日])/.test(msg.content)) {
      score += 0.3;
    }
  }
  score += Math.min(list.length / 20, 10);
  return score;
}

function cleanText(content: string): string {
  return sanitizeWechatText(content.replace(/\s+/g, ' ')).slice(0, 240);
}

export function cleanDisplayName(display: string, wxid: string, isGroup: boolean): string {
  return displayWechatName(display, wxid, {
    groupFallback: isGroup ? '微信群聊' : undefined,
    contactFallback: '微信联系人',
  });
}

function cleanSenderDisplay(display: string, wxid: string): string | null {
  const cleaned = displayWechatName(display, wxid, { contactFallback: '群成员' });
  return cleaned === '群成员' ? null : cleaned;
}
