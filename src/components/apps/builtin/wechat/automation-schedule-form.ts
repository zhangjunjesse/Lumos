/**
 * 自动化「时间规则」纯逻辑层：一次性时间戳 ↔ datetime-local、周期 cron ↔
 * 可视化配置（每天 / 每周 / 每 N 小时 / 每 N 分钟）的互转。无 JSX，可单测。
 *
 * 这四种模式与调度引擎 parseAutomationSchedule 实际支持的形态**严格一一
 * 对应**——不再有自由 cron 输入框：旧版那个框能写任意 5 段，但引擎只认
 * 这四种，其余静默降级成"仅保存规则"死任务。UI 能选的现在都保证能跑。
 */
import type { Automation, AutomationKind } from './relations-types';

export type RecurringScheduleMode = 'daily' | 'weekly' | 'hourly' | 'minutely';

export interface RecurringScheduleConfig {
  mode: RecurringScheduleMode;
  time: string;
  weekday: string;
  intervalHours: number;
  intervalMinutes: number;
}

export const WEEKDAY_OPTIONS = [
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
  { value: '0', label: '周日' },
] as const;

export function parseRecurringScheduleConfig(cron: string): RecurringScheduleConfig {
  // 无法识别时落到「每天 09:00」——不再有 custom 兜底（自由 cron 已删）。
  // 存量任意 cron 会显示成每天默认；用户一动控件就归一成可运行 cron。
  const fallback: RecurringScheduleConfig = {
    mode: 'daily',
    time: '09:00',
    weekday: '1',
    intervalHours: 4,
    intervalMinutes: 30,
  };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return fallback;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isCronMinute(minute) && isCronHour(hour)) {
    return { ...fallback, mode: 'daily', time: formatClock(Number(hour), Number(minute)) };
  }
  if (dayOfMonth === '*' && month === '*' && isCronMinute(minute) && isCronHour(hour) && /^[0-6]$/.test(dayOfWeek)) {
    return { ...fallback, mode: 'weekly', time: formatClock(Number(hour), Number(minute)), weekday: dayOfWeek };
  }
  const hourStep = /^\*\/(\d{1,2})$/.exec(hour);
  if (isCronMinute(minute) && hourStep && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return {
      ...fallback,
      mode: 'hourly',
      time: formatClock(9, Number(minute)),
      intervalHours: Math.max(1, Math.min(24, Number(hourStep[1]) || 4)),
    };
  }
  const minuteStep = /^\*\/(\d{1,2})$/.exec(minute);
  if (minuteStep && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return {
      ...fallback,
      mode: 'minutely',
      intervalMinutes: Math.max(1, Math.min(59, Number(minuteStep[1]) || 30)),
    };
  }
  return fallback;
}

export function buildRecurringPatch(config: RecurringScheduleConfig): Partial<Automation> {
  if (config.mode === 'weekly') {
    const time = parseTimeParts(config.time) ?? { hour: 9, minute: 0 };
    const weekday = /^[0-6]$/.test(config.weekday) ? config.weekday : '1';
    return {
      kind: 'reminder_recurring',
      cron: `${time.minute} ${time.hour} * * ${weekday}`,
      cronLabel: `每${weekdayText(weekday)} ${formatClock(time.hour, time.minute)}`,
    };
  }
  if (config.mode === 'hourly') {
    const intervalHours = Math.max(1, Math.min(24, Number(config.intervalHours) || 1));
    return {
      kind: 'reminder_recurring',
      cron: `0 */${intervalHours} * * *`,
      cronLabel: `每 ${intervalHours} 小时`,
    };
  }
  if (config.mode === 'minutely') {
    const intervalMinutes = Math.max(1, Math.min(59, Number(config.intervalMinutes) || 30));
    return {
      kind: 'reminder_recurring',
      cron: `*/${intervalMinutes} * * * *`,
      cronLabel: `每 ${intervalMinutes} 分钟`,
    };
  }
  const time = parseTimeParts(config.time) ?? { hour: 9, minute: 0 };
  return {
    kind: 'reminder_recurring',
    cron: `${time.minute} ${time.hour} * * *`,
    cronLabel: `每天 ${formatClock(time.hour, time.minute)}`,
  };
}

/**
 * 这条 cron 是否能被友好编辑器无损表达（即引擎四种可运行形态之一）。
 * 用解析→重建是否回到自身判定，零重复那四组规则。存量里非这四种的
 * cron（如每月/范围/列表）会被判 false，弹框据此归一，避免"显示每天
 * 09:00 实际存的是别的"这种 UI 撒谎 + 存量静默不可运行。
 */
export function isSupportedRecurringCron(cron: string): boolean {
  return buildRecurringPatch(parseRecurringScheduleConfig(cron)).cron === cron.trim();
}

export function parseTimeParts(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function formatClock(hour: number, minute: number): string {
  return `${pad2(Math.max(0, Math.min(23, hour)))}:${pad2(Math.max(0, Math.min(59, minute)))}`;
}

export function isCronMinute(value: string): boolean {
  return /^\d{1,2}$/.test(value) && Number(value) >= 0 && Number(value) <= 59;
}

export function isCronHour(value: string): boolean {
  return /^\d{1,2}$/.test(value) && Number(value) >= 0 && Number(value) <= 23;
}

export function weekdayText(value: string): string {
  return WEEKDAY_OPTIONS.find((item) => item.value === value)?.label ?? '周一';
}

export function nextMorningTs(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export function datetimeLocalValue(ts?: number): string {
  if (!ts) return '';
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return '';
  return [
    date.getFullYear(), '-', pad2(date.getMonth() + 1), '-', pad2(date.getDate()),
    'T', pad2(date.getHours()), ':', pad2(date.getMinutes()),
  ].join('');
}

export function parseDatetimeLocal(value: string): number | null {
  if (!value.trim()) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export function oneTimeLabel(ts: number): string {
  const date = new Date(ts);
  return [
    date.getFullYear(), '-', pad2(date.getMonth() + 1), '-', pad2(date.getDate()),
    ' ', pad2(date.getHours()), ':', pad2(date.getMinutes()),
  ].join('');
}

export function cronFromTimestamp(ts: number): string {
  const date = new Date(ts);
  return `${date.getMinutes()} ${date.getHours()} * * *`;
}

/** 把一次性执行时间(ms)归一成 cron / cronLabel / nextRunAt 三件套补丁。 */
export function buildOncePatch(ts: number): Partial<Automation> {
  return {
    kind: 'reminder_once',
    cron: cronFromTimestamp(ts),
    cronLabel: oneTimeLabel(ts),
    nextRunAt: ts,
  };
}

export function defaultOnceAt(): number {
  return Date.now() + 60 * 60 * 1000;
}

export function kindLabel(kind: AutomationKind): string {
  return kind === 'reminder_once' ? '一次性' : '定期';
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
