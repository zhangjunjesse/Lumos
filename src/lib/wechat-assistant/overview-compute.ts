/**
 * Pure overview-data builder. Takes the raw shape returned by
 * `analyze_snapshot` (api.py) and produces a normalized OverviewData
 * suitable for rendering. No IO, fully testable.
 */

import type {
  OverviewData,
  OverviewDay,
  OverviewReportInsights,
  OverviewRow,
} from './overview-types';
import { displayWechatName, safeSanitizedWechatText } from './wechat-text';

const DAY_MS = 24 * 60 * 60 * 1000;
const HEATMAP_DAYS = 14;
const SILENT_LOWER_DAYS = 14;
const SILENT_UPPER_DAYS = 60;
const WEEK_MS = 7 * DAY_MS;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const COMMITMENT_RE = /(我(会|来|去|帮|负责|处理|安排|发|给|补|改|确认|看看|问|约|订|做)|明天|今晚|今天|周[一二三四五六日天]|下周|月底|报价|方案|合同|回款|资料)/;

export interface SnapshotSession {
  wxid: string;
  display: string;
  is_group?: boolean;
  message_count?: number;
  last_timestamp?: number;
  unread_count?: number;
}

export interface SnapshotMessage {
  wxid: string;
  ts: number;
  sender: 'me' | 'them';
  senderWxid?: string | null;
  senderDisplay?: string | null;
  content: string;
}

export interface SnapshotInput {
  sessions: SnapshotSession[];
  messages: SnapshotMessage[];
}

export interface ComputeOptions {
  windowDays: number;
  excludedIds: ReadonlyArray<string>;
  nowMs: number;
}

interface RowAccumulator {
  count: number;
  yourCount: number;
  daily: number[]; // indexed by daysAgo, length 14
}

interface LateAccumulator {
  count: number;
}

interface CommitmentCandidate {
  wxid: string;
  tsMs: number;
  text: string;
}

export function computeOverview(
  snapshot: SnapshotInput,
  options: ComputeOptions,
): OverviewData {
  const { windowDays, nowMs } = options;
  const excluded = new Set(options.excludedIds);
  const windowMs = windowDays * DAY_MS;
  const windowFloor = nowMs - windowMs;

  const sessionMap = new Map<string, SnapshotSession>();
  for (const s of snapshot.sessions) {
    if (s.wxid && !excluded.has(s.wxid)) sessionMap.set(s.wxid, s);
  }

  const acc = new Map<string, RowAccumulator>();
  const emojiCounts = new Map<string, number>();
  const lateCounts = new Map<string, LateAccumulator>();
  const weekMentions = new Map<string, number>();
  const commitments: CommitmentCandidate[] = [];
  let lateTotal = 0;
  // Per-wxid max ts seen in messages — fallback when session metadata is
  // missing (api.py session list is capped, can miss long-tail chats).
  const maxTsByWxid = new Map<string, number>();

  /**
   * Resolve the chat's display info. Synthesises a stub for wxids that have
   * messages but didn't make it into `list_sessions` — otherwise those
   * messages get silently dropped, which on heavy accounts ate a chunk of
   * the corpus. is_group is derivable from the wxid suffix.
   */
  const lookupChat = (wxid: string): { isGroup: boolean; display: string; lastTs: number } => {
    const known = sessionMap.get(wxid);
    if (known) {
      return {
        isGroup: !!known.is_group,
        display: displayChatName(known.display, wxid),
        lastTs: toMs(known.last_timestamp ?? 0),
      };
    }
    return {
      isGroup: wxid.endsWith('@chatroom'),
      display: displayChatName(null, wxid),
      lastTs: 0, // filled in from message stream below
    };
  };

  for (const m of snapshot.messages) {
    if (!m.wxid || excluded.has(m.wxid)) continue;
    const tsMs = toMs(m.ts);
    if (tsMs < windowFloor) continue;

    const cell = acc.get(m.wxid) ?? { count: 0, yourCount: 0, daily: emptyDaily() };
    cell.count += 1;
    if (m.sender === 'me') cell.yourCount += 1;

    const daysAgo = Math.floor((nowMs - tsMs) / DAY_MS);
    if (daysAgo >= 0 && daysAgo < HEATMAP_DAYS) cell.daily[daysAgo] += 1;

    acc.set(m.wxid, cell);
    const prevMax = maxTsByWxid.get(m.wxid) ?? 0;
    if (tsMs > prevMax) maxTsByWxid.set(m.wxid, tsMs);

    collectEmojiCounts(m.content, emojiCounts);

    const hour = new Date(tsMs).getHours();
    if (hour >= 22 || hour < 2) {
      const late = lateCounts.get(m.wxid) ?? { count: 0 };
      late.count += 1;
      lateCounts.set(m.wxid, late);
      lateTotal += 1;
    }

    if (tsMs >= nowMs - WEEK_MS) {
      weekMentions.set(m.wxid, (weekMentions.get(m.wxid) ?? 0) + 1);
    }

    if (m.sender === 'me') {
      const text = cleanContent(m.content);
      if (text && COMMITMENT_RE.test(text)) {
        commitments.push({ wxid: m.wxid, tsMs, text });
      }
    }
  }

  const rows: OverviewRow[] = [];
  for (const [wxid, cell] of acc) {
    const chat = lookupChat(wxid);
    const lastTs = chat.lastTs > 0 ? chat.lastTs : maxTsByWxid.get(wxid) ?? 0;
    rows.push({
      id: wxid,
      name: chat.display,
      isGroup: chat.isGroup,
      messageCount: cell.count,
      yourShare: cell.count > 0 ? cell.yourCount / cell.count : 0,
      lastTs,
      interactionDays: cell.daily.map<OverviewDay>((count, daysAgo) => ({ daysAgo, count })),
    });
  }
  rows.sort((a, b) => b.lastTs - a.lastTs);

  const messagesInWindow = rows.reduce((s, r) => s + r.messageCount, 0);

  // silentCount surveys ALL non-excluded sessions, not just `rows`, so it
  // remains informative even when the analysis window is short.
  let silentCount = 0;
  const silentLower = nowMs - SILENT_LOWER_DAYS * DAY_MS;
  const silentUpper = nowMs - SILENT_UPPER_DAYS * DAY_MS;
  for (const s of sessionMap.values()) {
    const lastTs = toMs(s.last_timestamp ?? 0);
    if (lastTs > 0 && lastTs <= silentLower && lastTs >= silentUpper) silentCount += 1;
  }

  return {
    generatedAt: nowMs,
    windowDays,
    totals: {
      activeChats: rows.length,
      messagesInWindow,
      silentCount,
    },
    rows,
    reportInsights: buildReportInsights({
      emojiCounts,
      lateCounts,
      lateTotal,
      commitments,
      weekMentions,
      messagesInWindow,
      lookupChat,
    }),
  };
}

function buildReportInsights({
  emojiCounts,
  lateCounts,
  lateTotal,
  commitments,
  weekMentions,
  messagesInWindow,
  lookupChat,
}: {
  emojiCounts: Map<string, number>;
  lateCounts: Map<string, LateAccumulator>;
  lateTotal: number;
  commitments: CommitmentCandidate[];
  weekMentions: Map<string, number>;
  messagesInWindow: number;
  lookupChat: (wxid: string) => { isGroup: boolean; display: string; lastTs: number };
}): OverviewReportInsights {
  return {
    emoji: topEntries(emojiCounts, 8).map(([emoji, count]) => ({ emoji, count })),
    lateChat: {
      totalLateMessages: lateTotal,
      share: messagesInWindow > 0 ? lateTotal / messagesInWindow : 0,
      rows: topEntriesMap(lateCounts, 6, (value) => value.count).map(([wxid, value]) => {
        const chat = lookupChat(wxid);
        return {
          id: wxid,
          name: chat.display,
          messages: value.count,
          share: lateTotal > 0 ? value.count / lateTotal : 0,
        };
      }),
    },
    commitments: commitments
      .sort((a, b) => b.tsMs - a.tsMs)
      .slice(0, 8)
      .map((item, index) => {
        const chat = lookupChat(item.wxid);
        return {
          id: `${item.wxid}-${item.tsMs}-${index}`,
          text: item.text,
          who: chat.display,
          promisedAt: item.tsMs,
        };
      }),
    mentionWeek: topEntries(weekMentions, 8).map(([wxid, mentions]) => {
      const chat = lookupChat(wxid);
      return {
        id: wxid,
        name: chat.display,
        mentions,
      };
    }),
  };
}

function collectEmojiCounts(content: string, counts: Map<string, number>): void {
  for (const match of content.matchAll(EMOJI_RE)) {
    const emoji = match[0];
    counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  }
}

function cleanContent(content: string): string {
  return safeSanitizedWechatText(content, '').replace(/\s+/g, ' ').trim().slice(0, 48);
}

function displayChatName(display: string | null | undefined, wxid: string): string {
  return displayWechatName(display, wxid, {
    groupFallback: '微信群聊',
    contactFallback: '微信联系人',
  });
}

function topEntries(map: Map<string, number>, limit: number): Array<[string, number]> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function topEntriesMap<T>(
  map: Map<string, T>,
  limit: number,
  getValue: (value: T) => number,
): Array<[string, T]> {
  return [...map.entries()]
    .sort((a, b) => getValue(b[1]) - getValue(a[1]))
    .slice(0, limit);
}

/** api.py emits `create_time` as unix seconds; some fields may already be ms. */
function toMs(ts: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  return ts < 1e12 ? ts * 1000 : ts;
}

function emptyDaily(): number[] {
  return Array.from({ length: HEATMAP_DAYS }, () => 0);
}
