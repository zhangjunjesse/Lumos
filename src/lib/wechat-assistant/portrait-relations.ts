import type { WeChatSnapshotMessage } from './analysis';

export interface PortraitContact {
  wxid: string;
  display: string;
  isGroup: boolean;
  count: number;
}

export interface RisingContact extends PortraitContact {
  recent: number;
  previous: number;
  delta: number;
}

export interface SilentContact extends PortraitContact {
  daysSinceLast: number;
  lastAt: number;
}

export interface PortraitRelationships {
  summary: string;
  rising: RisingContact[];
  fading: RisingContact[];
  silent: SilentContact[];
}

export interface ResponseEntry extends PortraitContact {
  medianMinutes: number;
  sample: number;
}

export interface PortraitResponsiveness {
  summary: string;
  yourMedianMinutes: number | null;
  yourSampleSize: number;
  theirMedianMinutes: number | null;
  theirSampleSize: number;
  fastestForYou: ResponseEntry[];
  slowestForYou: ResponseEntry[];
}

export interface GroupRoleEntry extends PortraitContact {
  yourCount: number;
  participation: number;
  role: '潜水党' | '气氛组' | '话题灵魂' | '广播站';
}

export interface PortraitGroups {
  summary: string;
  topGroups: GroupRoleEntry[];
}

const DAY_SECONDS = 24 * 60 * 60;
const RECENT_WINDOW_DAYS = 14;

export function buildRelationships(messages: WeChatSnapshotMessage[]): PortraitRelationships {
  if (messages.length === 0) {
    return { summary: '暂无可分析的会话。', rising: [], fading: [], silent: [] };
  }
  const now = Math.max(...messages.map((m) => m.ts));
  const cutoff = now - RECENT_WINDOW_DAYS * DAY_SECONDS;
  const previousCutoff = cutoff - RECENT_WINDOW_DAYS * DAY_SECONDS;

  const buckets = new Map<string, { recent: number; previous: number; lastAt: number; meta: PortraitContact }>();
  for (const msg of messages) {
    const entry = buckets.get(msg.wxid) ?? {
      recent: 0,
      previous: 0,
      lastAt: 0,
      meta: { wxid: msg.wxid, display: msg.display, isGroup: msg.isGroup, count: 0 },
    };
    entry.meta.count += 1;
    entry.lastAt = Math.max(entry.lastAt, msg.ts);
    if (msg.ts >= cutoff) entry.recent += 1;
    else if (msg.ts >= previousCutoff) entry.previous += 1;
    buckets.set(msg.wxid, entry);
  }

  const all = Array.from(buckets.values());
  const rising: RisingContact[] = all
    .filter((item) => item.recent >= 4 && item.recent > item.previous)
    .map((item) => ({
      ...item.meta,
      recent: item.recent,
      previous: item.previous,
      delta: item.recent - item.previous,
    }))
    .sort((a, b) => b.delta - a.delta || b.recent - a.recent)
    .slice(0, 5);
  const fading: RisingContact[] = all
    .filter((item) => item.previous >= 6 && item.previous > item.recent * 2)
    .map((item) => ({
      ...item.meta,
      recent: item.recent,
      previous: item.previous,
      delta: item.recent - item.previous,
    }))
    .sort((a, b) => a.delta - b.delta || b.previous - a.previous)
    .slice(0, 5);
  const silent: SilentContact[] = all
    .filter((item) => !item.meta.isGroup && item.meta.count >= 5 && now - item.lastAt >= 21 * DAY_SECONDS)
    .map((item) => ({
      ...item.meta,
      daysSinceLast: Math.round((now - item.lastAt) / DAY_SECONDS),
      lastAt: item.lastAt,
    }))
    .sort((a, b) => b.daysSinceLast - a.daysSinceLast)
    .slice(0, 5);

  const summaryParts: string[] = [];
  if (rising.length) summaryParts.push(`${rising.length} 位关系正在升温`);
  if (fading.length) summaryParts.push(`${fading.length} 位最近沉默`);
  if (silent.length) summaryParts.push(`${silent.length} 位老朋友超过三周没说话`);
  const summary = summaryParts.length
    ? `近两周对比之前两周：${summaryParts.join('，')}。`
    : '关系活跃度比较稳定，没有明显的升温或降温信号。';

  return { summary, rising, fading, silent };
}

export function buildResponsiveness(messages: WeChatSnapshotMessage[]): PortraitResponsiveness {
  const yourGaps: number[] = [];
  const theirGaps: number[] = [];
  const perContact = new Map<string, { gaps: number[]; meta: PortraitContact }>();
  const grouped = groupBy(messages.filter((m) => !m.isGroup), (m) => m.wxid);

  for (const [wxid, list] of grouped) {
    const ordered = list.slice().sort((a, b) => a.ts - b.ts);
    const meta: PortraitContact = {
      wxid,
      display: ordered[0]?.display ?? wxid,
      isGroup: false,
      count: ordered.length,
    };
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (prev.sender === cur.sender) continue;
      const gapMinutes = (cur.ts - prev.ts) / 60;
      if (gapMinutes <= 0 || gapMinutes > 60 * 12) continue;
      if (cur.sender === 'me') {
        yourGaps.push(gapMinutes);
      } else {
        theirGaps.push(gapMinutes);
        const entry = perContact.get(wxid) ?? { gaps: [], meta };
        entry.gaps.push(gapMinutes);
        perContact.set(wxid, entry);
      }
    }
  }

  const contacts: ResponseEntry[] = Array.from(perContact.values())
    .filter((item) => item.gaps.length >= 3)
    .map((item) => ({
      ...item.meta,
      medianMinutes: median(item.gaps),
      sample: item.gaps.length,
    }));
  const fastestForYou = contacts.slice().sort((a, b) => a.medianMinutes - b.medianMinutes).slice(0, 3);
  const slowestForYou = contacts.slice().sort((a, b) => b.medianMinutes - a.medianMinutes).slice(0, 3);

  return {
    summary: buildResponseSummary(yourGaps.length, theirGaps.length, yourGaps, theirGaps),
    yourMedianMinutes: yourGaps.length ? median(yourGaps) : null,
    yourSampleSize: yourGaps.length,
    theirMedianMinutes: theirGaps.length ? median(theirGaps) : null,
    theirSampleSize: theirGaps.length,
    fastestForYou,
    slowestForYou,
  };
}

export function buildGroups(messages: WeChatSnapshotMessage[]): PortraitGroups {
  const groupMessages = messages.filter((m) => m.isGroup);
  if (groupMessages.length === 0) {
    return { summary: '暂未读取到群聊数据。', topGroups: [] };
  }
  const grouped = groupBy(groupMessages, (m) => m.wxid);
  const topGroups: GroupRoleEntry[] = Array.from(grouped.entries())
    .map(([wxid, list]) => {
      const yourCount = list.filter((m) => m.sender === 'me').length;
      const total = list.length;
      const participation = total === 0 ? 0 : yourCount / total;
      return {
        wxid,
        display: list[0]?.display ?? wxid,
        isGroup: true,
        count: total,
        yourCount,
        participation,
        role: roleOf(participation, yourCount),
      } as GroupRoleEntry;
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const dive = topGroups.filter((g) => g.role === '潜水党').length;
  const active = topGroups.filter((g) => g.role !== '潜水党').length;
  const summary = `共看到 ${topGroups.length} 个高频群，其中 ${active} 个你主动参与，${dive} 个你基本只看不说。`;
  return { summary, topGroups };
}

function buildResponseSummary(yourN: number, theirN: number, you: number[], them: number[]): string {
  if (yourN === 0 && theirN === 0) return '没有形成稳定的来回对话样本。';
  const youLabel = yourN > 0 ? `你回别人中位 ${formatMinutes(median(you))}` : '';
  const themLabel = theirN > 0 ? `别人回你中位 ${formatMinutes(median(them))}` : '';
  return [youLabel, themLabel].filter(Boolean).join('，') + '。';
}

function roleOf(participation: number, yourCount: number): GroupRoleEntry['role'] {
  if (yourCount === 0) return '潜水党';
  if (yourCount >= 50 && participation >= 0.4) return '广播站';
  if (participation >= 0.25) return '话题灵魂';
  if (participation >= 0.08) return '气氛组';
  return '潜水党';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatMinutes(value: number): string {
  if (value < 1) return '不到 1 分钟';
  if (value < 60) return `${Math.round(value)} 分钟`;
  if (value < 60 * 12) return `${(value / 60).toFixed(1)} 小时`;
  return `${(value / (60 * 24)).toFixed(1)} 天`;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}
