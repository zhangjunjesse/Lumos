/**
 * 自动化 cron/时间规则解析（schedule-parse 层，纯函数无副作用）。
 *
 * 把 Automation 的 cron/nextRunAt 解析成调度器可用的 ParsedSchedule，并提供
 * legacy 每日总结任务的时间换算。从 automations.ts 拆出（CLAUDE.md 单文件
 * ≤300 行；与 lifecycle/store 关注点分离，便于单测）。
 */
import type { Automation } from '@/components/apps/builtin/wechat/relations-types';

export interface ParsedSchedule {
  runMode: 'scheduled' | 'once';
  intervalMinutes: number;
  scheduleTime: string | null;
  scheduleDayOfWeek: number | null;
  nextRunAt?: string;
}

export function parseAutomationSchedule(
  input: Pick<Automation, 'kind' | 'cron' | 'nextRunAt'>,
): ParsedSchedule | null {
  if (input.kind === 'reminder_once') {
    if (!input.nextRunAt || input.nextRunAt <= Date.now()) return null;
    return {
      runMode: 'once',
      intervalMinutes: 0,
      scheduleTime: null,
      scheduleDayOfWeek: null,
      nextRunAt: new Date(input.nextRunAt).toISOString(),
    };
  }

  const parts = input.cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isInt(minute) && isInt(hour)) {
    return {
      runMode: 'scheduled',
      intervalMinutes: 1440,
      scheduleTime: `${padHour(Number(hour))}:${padMinute(Number(minute))}`,
      scheduleDayOfWeek: null,
    };
  }

  if (dayOfMonth === '*' && month === '*' && isInt(minute) && isInt(hour) && isWeekday(dayOfWeek)) {
    return {
      runMode: 'scheduled',
      intervalMinutes: 10080,
      scheduleTime: `${padHour(Number(hour))}:${padMinute(Number(minute))}`,
      scheduleDayOfWeek: Number(dayOfWeek),
    };
  }

  const minuteStep = /^\*\/(\d+)$/.exec(minute);
  if (minuteStep && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = Number(minuteStep[1]);
    return interval > 0 ? {
      runMode: 'scheduled',
      intervalMinutes: interval,
      scheduleTime: null,
      scheduleDayOfWeek: null,
    } : null;
  }

  const hourStep = /^\*\/(\d+)$/.exec(hour);
  if (isInt(minute) && hourStep && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = Number(hourStep[1]) * 60;
    return interval > 0 ? {
      runMode: 'scheduled',
      intervalMinutes: interval,
      scheduleTime: null,
      scheduleDayOfWeek: null,
    } : null;
  }

  return null;
}

export function parseIsoMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

function isInt(value: string): boolean {
  return /^\d{1,2}$/.test(value);
}

function isWeekday(value: string): boolean {
  return /^[0-6]$/.test(value);
}

function padHour(value: number): string {
  return String(Math.min(23, Math.max(0, value))).padStart(2, '0');
}

function padMinute(value: number): string {
  return String(Math.min(59, Math.max(0, value))).padStart(2, '0');
}
