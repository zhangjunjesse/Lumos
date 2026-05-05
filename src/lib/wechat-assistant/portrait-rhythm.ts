import type { WeChatSnapshotMessage } from './analysis';

export interface PortraitRhythm {
  label: string;
  summary: string;
  hourly: Array<{ hour: number; count: number }>;
  weekly: Array<{ weekday: number; count: number }>;
  peakHour: number;
  peakHourCount: number;
  earliestHour: number | null;
  latestHour: number | null;
  weekdayShare: number;
  weekendShare: number;
  lateNightShare: number;
  daysActive: number;
}

export interface PortraitStyle {
  label: string;
  summary: string;
  yourMessageCount: number;
  avgLength: number;
  longestLength: number;
  questionRate: number;
  exclaimRate: number;
  emojiTop: Array<{ emoji: string; count: number }>;
  wordTop: Array<{ word: string; count: number }>;
}

const STOP_WORDS = new Set([
  '我们', '你们', '他们', '一个', '一下', '什么', '怎么', '没有', '可以', '不要',
  '不是', '是的', '好的', '收到', '谢谢', '哈哈', '嗯嗯', '哦哦', '这个', '那个',
  '这样', '那样', '现在', '今天', '明天', '昨天', '应该', '可能', '不过', '但是',
  '因为', '所以', '已经', '还有', '就是', '感觉', '觉得', '知道', '不太', '一般',
  '然后', '其实', '比如', '估计', '大概', '差不多', '为什么', '怎么样',
]);
const EMOJI_REGEX = /(\p{Extended_Pictographic}|\[[^\]]{1,8}\])/gu;
const CHINESE_WORD_REGEX = /[一-龥]{2,4}/g;
const ENGLISH_WORD_REGEX = /[A-Za-z]{3,12}/g;
const PLACEHOLDER_PATTERN = /^\s*\[[^\]]+\]\s*$/;
const LATE_NIGHT_HOURS = new Set([0, 1, 2, 3, 4, 23]);

export function buildRhythm(messages: WeChatSnapshotMessage[]): PortraitRhythm {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const weekly = Array.from({ length: 7 }, (_, weekday) => ({ weekday, count: 0 }));
  const dayKeys = new Set<string>();
  let weekdayCount = 0;
  let weekendCount = 0;
  let lateNight = 0;
  let earliestHour: number | null = null;
  let latestHour: number | null = null;
  for (const msg of messages) {
    const date = new Date(msg.ts * 1000);
    const hour = date.getHours();
    const day = date.getDay();
    const weekdayIndex = (day + 6) % 7;
    hourly[hour].count += 1;
    weekly[weekdayIndex].count += 1;
    if (LATE_NIGHT_HOURS.has(hour)) lateNight += 1;
    if (day === 0 || day === 6) weekendCount += 1;
    else weekdayCount += 1;
    earliestHour = earliestHour === null ? hour : Math.min(earliestHour, hour);
    latestHour = latestHour === null ? hour : Math.max(latestHour, hour);
    dayKeys.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  }
  const peak = hourly.reduce((acc, item) => (item.count > acc.count ? item : acc), hourly[0]);
  const total = messages.length;
  const weekdayShare = weekdayCount / total;
  const weekendShare = weekendCount / total;
  const lateNightShare = lateNight / total;
  const label = describeRhythmLabel(peak.hour, lateNightShare, weekendShare);
  const summary = describeRhythmSummary({
    peakHour: peak.hour,
    label,
    weekdayShare,
    weekendShare,
    lateNightShare,
    daysActive: dayKeys.size,
  });
  return {
    label,
    summary,
    hourly,
    weekly,
    peakHour: peak.hour,
    peakHourCount: peak.count,
    earliestHour,
    latestHour,
    weekdayShare,
    weekendShare,
    lateNightShare,
    daysActive: dayKeys.size,
  };
}

export function buildStyle(messages: WeChatSnapshotMessage[]): PortraitStyle {
  const mine = messages.filter((m) => m.sender === 'me' && !PLACEHOLDER_PATTERN.test(m.content));
  if (mine.length === 0) {
    return {
      label: '潜水观察者',
      summary: '主要在收消息，自己几乎不说话。',
      yourMessageCount: 0,
      avgLength: 0,
      longestLength: 0,
      questionRate: 0,
      exclaimRate: 0,
      emojiTop: [],
      wordTop: [],
    };
  }
  let totalLen = 0;
  let longest = 0;
  let questions = 0;
  let exclaims = 0;
  const emojiCounter = new Map<string, number>();
  const wordCounter = new Map<string, number>();
  for (const msg of mine) {
    const len = [...msg.content].length;
    totalLen += len;
    longest = Math.max(longest, len);
    if (/[?？]/.test(msg.content)) questions += 1;
    if (/[!！]/.test(msg.content)) exclaims += 1;
    for (const match of msg.content.matchAll(EMOJI_REGEX)) {
      const token = match[0];
      emojiCounter.set(token, (emojiCounter.get(token) ?? 0) + 1);
    }
    accumulateWords(msg.content, wordCounter);
  }
  const avgLength = Math.round(totalLen / mine.length);
  const questionRate = questions / mine.length;
  const exclaimRate = exclaims / mine.length;
  const emojiTop = Array.from(emojiCounter.entries())
    .map(([emoji, count]) => ({ emoji, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const wordTop = Array.from(wordCounter.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const label = describeStyleLabel({ avgLength, questionRate, exclaimRate, emojiCount: emojiTop.length });
  return {
    label,
    summary: describeStyleSummary({ avgLength, longest, questionRate, exclaimRate, emojiTop, label }),
    yourMessageCount: mine.length,
    avgLength,
    longestLength: longest,
    questionRate,
    exclaimRate,
    emojiTop,
    wordTop,
  };
}

function describeRhythmLabel(peakHour: number, lateNightShare: number, weekendShare: number): string {
  if (lateNightShare >= 0.2) return '深夜玩家';
  if (peakHour >= 22 || peakHour <= 1) return '夜猫子';
  if (peakHour >= 5 && peakHour <= 8) return '早起选手';
  if (weekendShare >= 0.45) return '周末党';
  if (peakHour >= 9 && peakHour <= 11) return '上午冲锋';
  if (peakHour >= 14 && peakHour <= 17) return '下午段子手';
  if (peakHour >= 19 && peakHour <= 21) return '黄金档玩家';
  return '全天候选手';
}

function describeRhythmSummary(input: {
  peakHour: number;
  label: string;
  weekdayShare: number;
  weekendShare: number;
  lateNightShare: number;
  daysActive: number;
}): string {
  const slot = `${String(input.peakHour).padStart(2, '0')}:00 前后是消息高峰`;
  const weekend = input.weekendShare >= 0.4
    ? '周末活跃度甚至高过工作日，看起来你不靠工作日撑场'
    : input.weekendShare >= 0.25
      ? '工作日为主，周末仍有持续节奏'
      : '基本在工作日里集中爆发';
  const night = input.lateNightShare >= 0.2 ? '深夜消息占比偏高，注意作息' : '深夜段比较克制';
  return `你被识别为「${input.label}」，${slot}，${weekend}，${night}。共在 ${input.daysActive} 天里有过聊天足迹。`;
}

function describeStyleLabel(input: {
  avgLength: number;
  questionRate: number;
  exclaimRate: number;
  emojiCount: number;
}): string {
  if (input.avgLength <= 6 && input.emojiCount >= 3) return '表情包冠军';
  if (input.avgLength <= 8) return '惜字如金';
  if (input.avgLength >= 40) return '小作文选手';
  if (input.questionRate >= 0.35) return '十万个为什么';
  if (input.exclaimRate >= 0.35) return '感叹号大户';
  return '稳健叙事派';
}

function describeStyleSummary(input: {
  avgLength: number;
  longest: number;
  questionRate: number;
  exclaimRate: number;
  emojiTop: Array<{ emoji: string; count: number }>;
  label: string;
}): string {
  const emoji = input.emojiTop[0]
    ? `常用「${input.emojiTop[0].emoji}」(${input.emojiTop[0].count} 次)`
    : '几乎不用表情';
  const punct: string[] = [];
  if (input.questionRate >= 0.2) punct.push(`${Math.round(input.questionRate * 100)}% 带问号`);
  if (input.exclaimRate >= 0.2) punct.push(`${Math.round(input.exclaimRate * 100)}% 带感叹`);
  const punctText = punct.length ? `；${punct.join('，')}` : '';
  return `平均每条 ${input.avgLength} 字（最长 ${input.longest} 字），${emoji}${punctText}。整体被打上「${input.label}」标签。`;
}

function accumulateWords(content: string, counter: Map<string, number>): void {
  const cn = content.match(CHINESE_WORD_REGEX) ?? [];
  for (const word of cn) {
    if (STOP_WORDS.has(word)) continue;
    counter.set(word, (counter.get(word) ?? 0) + 1);
  }
  const en = content.match(ENGLISH_WORD_REGEX) ?? [];
  for (const word of en) {
    const lower = word.toLowerCase();
    if (STOP_WORDS.has(lower)) continue;
    counter.set(lower, (counter.get(lower) ?? 0) + 1);
  }
}
