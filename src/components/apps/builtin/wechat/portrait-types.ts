export interface PortraitData {
  generated: boolean;
  rhythm: PortraitRhythm;
  relationships: PortraitRelationships;
  responsiveness: PortraitResponsiveness;
  style: PortraitStyle;
  groups: PortraitGroups;
  highlights: PortraitHighlight[];
}

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

export interface PortraitContact {
  wxid: string;
  display: string;
  isGroup: boolean;
  count: number;
}

export type RisingContact = PortraitContact & {
  recent: number;
  previous: number;
  delta: number;
};

export type SilentContact = PortraitContact & {
  daysSinceLast: number;
  lastAt: number;
};

export type ResponseEntry = PortraitContact & {
  medianMinutes: number;
  sample: number;
};

export type GroupRoleEntry = PortraitContact & {
  yourCount: number;
  participation: number;
  role: '潜水党' | '气氛组' | '话题灵魂' | '广播站';
};

export interface PortraitRelationships {
  summary: string;
  rising: RisingContact[];
  fading: RisingContact[];
  silent: SilentContact[];
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

export interface PortraitGroups {
  summary: string;
  topGroups: GroupRoleEntry[];
}

export interface PortraitHighlight {
  label: string;
  detail: string;
  meta?: string;
}

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function formatMinutesShort(value: number): string {
  if (value < 1) return '<1 分钟';
  if (value < 60) return `${Math.round(value)} 分钟`;
  if (value < 60 * 12) return `${(value / 60).toFixed(1)} 小时`;
  return `${(value / (60 * 24)).toFixed(1)} 天`;
}
