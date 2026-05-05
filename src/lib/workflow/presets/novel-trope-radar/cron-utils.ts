/**
 * Cron → Lumos schedule 字段翻译
 *
 * Lumos schedule 用 (intervalMinutes / scheduleTime / scheduleDayOfWeek)
 * 三元组,而不是原始 cron。本工具把用户填的 cron 翻译过去。
 *
 * 仅支持本 preset 用到的几种形态:
 *   - "M H * * D"   每周 D 几点 M 分跑 → 周维度
 *   - "M H * * *"   每天 H:M 跑       → 日维度 (interval=1440)
 *   - "M H D * *"   每月 D 号 H:M 跑  → 月维度 (interval=43200)
 *   - "STEP * * * *" 每 N 分钟         → 频率 (STEP 是 [asterisk]/N)
 *
 * 不在支持范围 → 退化为每周一 09:00。
 *
 * 抽出独立文件,使本工具不依赖 DB,便于单元测试。
 */

import { DEFAULT_RUN_PARAMS } from './types';

export interface CronSchedule {
  intervalMinutes: number;
  scheduleTime: string | null;
  scheduleDayOfWeek: number | null;
}

const DEFAULT_SCHEDULE: CronSchedule = {
  intervalMinutes: 10080,
  scheduleTime: '09:00',
  scheduleDayOfWeek: 1,
};

function numericOrZero(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseCronToSchedule(cron: string): CronSchedule {
  const parts = (cron ?? '').trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return cron === DEFAULT_RUN_PARAMS.cron
      ? DEFAULT_SCHEDULE
      : { ...DEFAULT_SCHEDULE };
  }
  // 6 段则首段为秒,丢弃
  const [minRaw, hourRaw, domRaw, , dowRaw] = parts.length === 6
    ? parts.slice(1)
    : parts;

  const intervalMatch = /^\*\/(\d+)$/.exec(minRaw);
  if (intervalMatch && hourRaw === '*' && domRaw === '*' && dowRaw === '*') {
    const n = Math.max(1, Math.min(60, Number(intervalMatch[1])));
    return { intervalMinutes: n, scheduleTime: null, scheduleDayOfWeek: null };
  }

  const minute = numericOrZero(minRaw);
  const hour = numericOrZero(hourRaw);
  const time = `${pad(hour)}:${pad(minute)}`;

  if (domRaw === '*' && /^\d+$/.test(dowRaw)) {
    return {
      intervalMinutes: 10080,
      scheduleTime: time,
      scheduleDayOfWeek: Number(dowRaw) % 7,
    };
  }

  if (/^\d+$/.test(domRaw) && dowRaw === '*') {
    return {
      intervalMinutes: 43200,
      scheduleTime: time,
      scheduleDayOfWeek: null,
    };
  }

  if (domRaw === '*' && dowRaw === '*') {
    return {
      intervalMinutes: 1440,
      scheduleTime: time,
      scheduleDayOfWeek: null,
    };
  }

  return { ...DEFAULT_SCHEDULE };
}
