import type { WeChatSnapshotMessage } from './analysis';
import type { PortraitRhythm, PortraitStyle } from './portrait-rhythm';
import type { PortraitResponsiveness } from './portrait-relations';

export interface PortraitHighlight {
  label: string;
  detail: string;
  meta?: string;
}

const PLACEHOLDER_PATTERN = /^\s*\[[^\]]+\]\s*$/;

export function buildHighlights(
  messages: WeChatSnapshotMessage[],
  rhythm: PortraitRhythm,
  style: PortraitStyle,
  responsiveness: PortraitResponsiveness,
): PortraitHighlight[] {
  const items: PortraitHighlight[] = [];
  const longestRound = findLongestRound(messages);
  if (longestRound) {
    items.push({
      label: '最长连续对话',
      detail: `和「${longestRound.display}」打了 ${longestRound.rounds} 个回合，跨度 ${formatDuration(longestRound.span)}。`,
      meta: formatTimestamp(longestRound.lastAt),
    });
  }
  const longestMessage = findLongestMessage(messages);
  if (longestMessage) {
    const len = [...longestMessage.content].length;
    items.push({
      label: longestMessage.sender === 'me' ? '你的小作文记录' : '收到的小作文',
      detail: `${len} 字，来自「${longestMessage.display}」。开头是：「${truncate(longestMessage.content, 36)}」`,
      meta: formatTimestamp(longestMessage.ts),
    });
  }
  const fastest = responsiveness.fastestForYou[0];
  if (fastest && fastest.medianMinutes <= 5) {
    items.push({
      label: '最秒回的人',
      detail: `「${fastest.display}」回你的中位数只要 ${formatRoughMinutes(fastest.medianMinutes)}（${fastest.sample} 次往返）。`,
    });
  }
  if (rhythm.daysActive > 0 && rhythm.peakHourCount > 0) {
    items.push({
      label: '黄金一小时',
      detail: `${String(rhythm.peakHour).padStart(2, '0')}:00 是你聊天最密集的时段，累计产生 ${rhythm.peakHourCount} 条消息。`,
    });
  }
  if (style.wordTop.length > 0 || style.emojiTop.length > 0) {
    const words = style.wordTop.slice(0, 3).map((w) => `「${w.word}」`).join('、') || '暂无明显高频词';
    const emojis = style.emojiTop.slice(0, 3).map((e) => e.emoji).join(' ') || '暂无明显表情偏好';
    items.push({ label: '微信口头禅', detail: `${words}是你最常挂嘴边的；表情则偏爱 ${emojis}。` });
  }
  return items.slice(0, 5);
}

function findLongestMessage(messages: WeChatSnapshotMessage[]): WeChatSnapshotMessage | null {
  let best: WeChatSnapshotMessage | null = null;
  for (const msg of messages) {
    if (PLACEHOLDER_PATTERN.test(msg.content)) continue;
    if (!best || [...msg.content].length > [...best.content].length) best = msg;
  }
  return best;
}

interface RoundResult {
  display: string;
  rounds: number;
  span: number;
  lastAt: number;
}

function findLongestRound(messages: WeChatSnapshotMessage[]): RoundResult | null {
  const grouped = new Map<string, WeChatSnapshotMessage[]>();
  for (const msg of messages) {
    if (msg.isGroup) continue;
    const list = grouped.get(msg.wxid) ?? [];
    list.push(msg);
    grouped.set(msg.wxid, list);
  }
  let best: RoundResult | null = null;
  for (const [, list] of grouped) {
    const ordered = list.slice().sort((a, b) => a.ts - b.ts);
    let rounds = 0;
    let startTs = ordered[0]?.ts ?? 0;
    let lastSender: WeChatSnapshotMessage['sender'] | null = null;
    let lastTs = startTs;
    for (const msg of ordered) {
      if (lastSender === null || msg.ts - lastTs > 30 * 60) {
        if (rounds >= 4 && (best === null || rounds > best.rounds)) {
          best = { display: ordered[0].display, rounds, span: lastTs - startTs, lastAt: lastTs };
        }
        rounds = 1;
        startTs = msg.ts;
        lastSender = msg.sender;
        lastTs = msg.ts;
        continue;
      }
      if (msg.sender !== lastSender) rounds += 1;
      lastSender = msg.sender;
      lastTs = msg.ts;
    }
    if (rounds >= 4 && (best === null || rounds > best.rounds)) {
      best = { display: ordered[0].display, rounds, span: lastTs - startTs, lastAt: lastTs };
    }
  }
  return best;
}

function truncate(text: string, max: number): string {
  const arr = [...text.replace(/\s+/g, ' ').trim()];
  return arr.length <= max ? arr.join('') : `${arr.slice(0, max).join('')}…`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return '不到 1 分钟';
  if (seconds < 60 * 60) return `${Math.round(seconds / 60)} 分钟`;
  if (seconds < 60 * 60 * 24) return `${(seconds / 3600).toFixed(1)} 小时`;
  return `${(seconds / (3600 * 24)).toFixed(1)} 天`;
}

function formatRoughMinutes(value: number): string {
  if (value < 1) return '不到 1 分钟';
  if (value < 60) return `${Math.round(value)} 分钟`;
  if (value < 60 * 12) return `${(value / 60).toFixed(1)} 小时`;
  return `${(value / (60 * 24)).toFixed(1)} 天`;
}

function formatTimestamp(seconds: number): string {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
