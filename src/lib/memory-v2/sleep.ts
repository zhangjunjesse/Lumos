import { randomUUID } from 'crypto';
import { getDb, getSetting, setSetting } from '@/lib/db';
import {
  buildMemoryV2ReflectionReport,
  createMemoryV2ReflectionEntry,
  type MemoryV2ReflectionReport,
} from './reflection';
import { generateMemoryV2ImprovementCandidates } from './self-improvement';
import { summarizeNewMemoryV2FromMessages } from './auto-summary';
import { summarizeNewMemoryV2CapabilityEvents } from './capability-events';
import { runMemoryV2CapabilityDiscovery } from './capability-discovery';

const ENABLED_KEY = 'memory_v2_sleep_enabled';
const TIME_KEY = 'memory_v2_sleep_time';
const TIMEZONE_KEY = 'memory_v2_sleep_timezone';
const LAST_RUN_DAY_KEY = 'memory_v2_sleep_last_run_day';
const LAST_RUN_AT_KEY = 'memory_v2_sleep_last_run_at';

const DEFAULT_SLEEP_TIME = '03:30';

export type MemoryV2SleepTrigger = 'manual' | 'daily' | 'api';
export type MemoryV2SleepStatus = 'success' | 'skipped' | 'error';

export interface MemoryV2SleepConfig {
  enabled: boolean;
  time: string;
  timezone: string;
  today: string;
  due: boolean;
  lastRunDay: string;
  lastRunAt: string | null;
  nextRunLabel: string;
}

export interface MemoryV2SleepRun {
  id: string;
  triggerType: MemoryV2SleepTrigger | string;
  runDay: string;
  status: MemoryV2SleepStatus;
  memoryId: string;
  report: MemoryV2ReflectionReport | null;
  error: string;
  startedAt: string;
  completedAt: string;
}

interface MemoryV2SleepRunRow {
  id: string;
  trigger_type: string;
  run_day: string;
  status: MemoryV2SleepStatus;
  memory_id: string;
  report_json: string;
  error: string;
  started_at: string;
  completed_at: string;
}

function nowSql(date = new Date()): string {
  return date.toISOString().replace('T', ' ').split('.')[0];
}

function normalizeTime(value?: string | null): string {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return DEFAULT_SLEEP_TIME;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function resolveTimezone(value?: string | null): string {
  const raw = String(value || '').trim();
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
  const candidate = raw || fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback;
  }
}

function localParts(date: Date, timezone: string): {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: Number(pick('hour') || 0),
    minute: Number(pick('minute') || 0),
  };
}

function localDayKey(date: Date, timezone: string): string {
  const parts = localParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minutesOfDay(time: string): number {
  const [hour, minute] = normalizeTime(time).split(':').map(Number);
  return hour * 60 + minute;
}

function buildNextRunLabel(config: {
  enabled: boolean;
  due: boolean;
  time: string;
  today: string;
  lastRunDay: string;
}): string {
  if (!config.enabled) return '已关闭';
  if (config.lastRunDay === config.today) return `明天 ${config.time}`;
  if (config.due) return '现在可运行';
  return `今天 ${config.time}`;
}

function safeParseReport(raw: string): MemoryV2ReflectionReport | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as MemoryV2ReflectionReport : null;
  } catch {
    return null;
  }
}

function rowToRun(row: MemoryV2SleepRunRow): MemoryV2SleepRun {
  return {
    id: row.id,
    triggerType: row.trigger_type,
    runDay: row.run_day,
    status: row.status,
    memoryId: row.memory_id,
    report: safeParseReport(row.report_json),
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function insertSleepRun(input: {
  triggerType: MemoryV2SleepTrigger;
  runDay: string;
  status: MemoryV2SleepStatus;
  memoryId?: string;
  report?: MemoryV2ReflectionReport;
  error?: string;
  startedAt: string;
  completedAt: string;
}): MemoryV2SleepRun {
  const id = randomUUID();
  getDb().prepare(
    `INSERT INTO memory_v2_sleep_runs
      (id, trigger_type, run_day, status, memory_id, report_json, error, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.triggerType,
    input.runDay,
    input.status,
    input.memoryId || '',
    JSON.stringify(input.report || {}),
    input.error || '',
    input.startedAt,
    input.completedAt,
  );
  return rowToRun(getDb().prepare('SELECT * FROM memory_v2_sleep_runs WHERE id = ?').get(id) as MemoryV2SleepRunRow);
}

export function getMemoryV2SleepConfig(now = new Date()): MemoryV2SleepConfig {
  const enabledSetting = getSetting(ENABLED_KEY);
  const enabled = enabledSetting === undefined ? true : enabledSetting === 'true';
  const time = normalizeTime(getSetting(TIME_KEY) || DEFAULT_SLEEP_TIME);
  const timezone = resolveTimezone(getSetting(TIMEZONE_KEY));
  const today = localDayKey(now, timezone);
  const lastRunDay = String(getSetting(LAST_RUN_DAY_KEY) || '').trim();
  const parts = localParts(now, timezone);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const due = enabled && lastRunDay !== today && nowMinutes >= minutesOfDay(time);
  return {
    enabled,
    time,
    timezone,
    today,
    due,
    lastRunDay,
    lastRunAt: getSetting(LAST_RUN_AT_KEY) || null,
    nextRunLabel: buildNextRunLabel({ enabled, due, time, today, lastRunDay }),
  };
}

export function updateMemoryV2SleepConfig(input: {
  enabled?: boolean;
  time?: string;
  timezone?: string;
}): MemoryV2SleepConfig {
  if (typeof input.enabled === 'boolean') {
    setSetting(ENABLED_KEY, input.enabled ? 'true' : 'false');
  }
  if (input.time !== undefined) {
    setSetting(TIME_KEY, normalizeTime(input.time));
  }
  if (input.timezone !== undefined) {
    setSetting(TIMEZONE_KEY, resolveTimezone(input.timezone));
  }
  return getMemoryV2SleepConfig();
}

export function listMemoryV2SleepRuns(limit = 20): MemoryV2SleepRun[] {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const rows = getDb().prepare(
    `SELECT * FROM memory_v2_sleep_runs
     ORDER BY completed_at DESC
     LIMIT ?`,
  ).all(safeLimit) as MemoryV2SleepRunRow[];
  return rows.map(rowToRun);
}

export function runMemoryV2Sleep(params: {
  trigger?: MemoryV2SleepTrigger;
  force?: boolean;
} = {}): MemoryV2SleepRun {
  const triggerType = params.trigger || 'manual';
  const startedAt = nowSql();
  const config = getMemoryV2SleepConfig();

  const finish = (input: {
    status: MemoryV2SleepStatus;
    memoryId?: string;
    report?: MemoryV2ReflectionReport;
    error?: string;
    updateLastRun?: boolean;
  }) => {
    const completedAt = nowSql();
    if (input.updateLastRun !== false) {
      setSetting(LAST_RUN_DAY_KEY, config.today);
      setSetting(LAST_RUN_AT_KEY, completedAt);
    }
    return insertSleepRun({
      triggerType,
      runDay: config.today,
      status: input.status,
      memoryId: input.memoryId,
      report: input.report,
      error: input.error,
      startedAt,
      completedAt,
    });
  };

  if (triggerType === 'daily' && !params.force) {
    if (!config.enabled) {
      return finish({ status: 'skipped', error: 'disabled', updateLastRun: false });
    }
    if (config.lastRunDay === config.today) {
      return finish({ status: 'skipped', error: 'already_ran_today', updateLastRun: false });
    }
    if (!config.due) {
      return finish({ status: 'skipped', error: 'not_due', updateLastRun: false });
    }
  }

  try {
    const autoMemory = summarizeNewMemoryV2FromMessages();
    const capabilityDiscovery = runMemoryV2CapabilityDiscovery();
    const capabilityEvents = summarizeNewMemoryV2CapabilityEvents();
    const report = buildMemoryV2ReflectionReport();
    if (
      report.stats.total === 0
      && autoMemory.created.length === 0
      && capabilityDiscovery.created.length === 0
      && capabilityEvents.created.length === 0
    ) {
      return finish({ status: 'skipped', report, error: 'no_memory_entries' });
    }
    const improvements = generateMemoryV2ImprovementCandidates();

    const result = createMemoryV2ReflectionEntry({
      report,
      sourceType: triggerType === 'daily' ? 'memory_v2_daily_sleep' : 'memory_v2_sleep',
      sourceId: `${config.today}:${triggerType}`,
      titlePrefix: triggerType === 'daily' ? '每日睡眠' : '睡眠运行',
      metadata: {
        sleep: {
          triggerType,
          runDay: config.today,
          timezone: config.timezone,
          scheduledTime: config.time,
        },
        selfImprovement: {
          scanned: improvements.scanned,
          created: improvements.created.length,
          totalCandidates: improvements.candidates.length,
        },
        autoMemory: {
          scannedMessages: autoMemory.scanned,
          consideredMessages: autoMemory.considered,
          created: autoMemory.created.length,
          maxRowId: autoMemory.maxRowId,
        },
        capabilityEvents: {
          scanned: capabilityEvents.scanned,
          created: capabilityEvents.created.length,
          maxRowId: capabilityEvents.maxRowId,
        },
        capabilityDiscovery: {
          scanned: capabilityDiscovery.scanned,
          created: capabilityDiscovery.created.length,
          skipped: capabilityDiscovery.skipped,
          sourceCounts: capabilityDiscovery.sourceCounts,
          mode: 'sleep-local',
        },
      },
    });
    return finish({ status: 'success', memoryId: result.memory.id, report: result.report });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finish({ status: 'error', error: message, updateLastRun: false });
  }
}

export function runDueMemoryV2Sleep(): MemoryV2SleepRun | null {
  const config = getMemoryV2SleepConfig();
  if (!config.due) return null;
  return runMemoryV2Sleep({ trigger: 'daily' });
}
