import { randomUUID } from 'crypto';
import { getDb, getSetting, setSetting } from '@/lib/db';
import {
  buildMemoryV2ReflectionReport,
  type MemoryV2ReflectionReport,
} from './reflection';
import {
  runMemoryV2Consolidation,
  runMemoryV2Decay,
  type MemoryV2ConsolidationResult,
} from './consolidation';
import { listMemoryV2EntriesMissingEmbedding, setMemoryV2Embedding } from './store';
import { embedMemoryEntryText, memoryEmbedText } from './vector';
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

// 睡眠运行记录里存的是「这次睡眠到底做了什么」的运营遥测，
// 不再写回 memory_v2_entries（底线①：系统自身状态不能当行动记忆）。
export interface MemoryV2SleepReport extends MemoryV2ReflectionReport {
  consolidation?: MemoryV2ConsolidationResult;
  decay?: { scanned: number; archived: number };
  embeddingBackfill?: { scanned: number; embedded: number };
  pipeline?: {
    autoMemory: { scanned: number; considered: number; created: number; maxRowId: number };
    capabilityEvents: { scanned: number; created: number; maxRowId: number };
    capabilityDiscovery: { scanned: number; created: number; skipped: number };
    selfImprovement: { scanned: number; created: number; totalCandidates: number };
  };
}

export interface MemoryV2SleepRun {
  id: string;
  triggerType: MemoryV2SleepTrigger | string;
  runDay: string;
  status: MemoryV2SleepStatus;
  memoryId: string;
  report: MemoryV2SleepReport | null;
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

function safeParseReport(raw: string): MemoryV2SleepReport | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as MemoryV2SleepReport : null;
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
  report?: MemoryV2SleepReport;
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
    '',
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

// 兜底回填：任何路径建的记忆若没向量，睡眠时补上，保证语义召回覆盖全量。
async function backfillMissingEmbeddings(limit = 200): Promise<{ scanned: number; embedded: number }> {
  const pending = listMemoryV2EntriesMissingEmbedding(limit);
  let embedded = 0;
  for (const entry of pending) {
    const buf = await embedMemoryEntryText(memoryEmbedText(entry.title, entry.body));
    if (buf && setMemoryV2Embedding(entry.id, buf)) embedded += 1;
  }
  return { scanned: pending.length, embedded };
}

export async function runMemoryV2Sleep(params: {
  trigger?: MemoryV2SleepTrigger;
  force?: boolean;
} = {}): Promise<MemoryV2SleepRun> {
  const triggerType = params.trigger || 'manual';
  const startedAt = nowSql();
  const config = getMemoryV2SleepConfig();

  const finish = (input: {
    status: MemoryV2SleepStatus;
    report?: MemoryV2SleepReport;
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
    const autoMemory = await summarizeNewMemoryV2FromMessages();
    const capabilityDiscovery = runMemoryV2CapabilityDiscovery();
    const capabilityEvents = summarizeNewMemoryV2CapabilityEvents();
    const consolidation = runMemoryV2Consolidation();
    const decay = runMemoryV2Decay();
    const embeddingBackfill = await backfillMissingEmbeddings();
    const improvements = generateMemoryV2ImprovementCandidates();
    const baseReport = buildMemoryV2ReflectionReport();

    if (
      baseReport.stats.total === 0
      && autoMemory.created.length === 0
      && capabilityDiscovery.created.length === 0
      && capabilityEvents.created.length === 0
      && consolidation.archived === 0
      && decay.archivedIds.length === 0
    ) {
      return finish({ status: 'skipped', report: baseReport, error: 'no_memory_entries' });
    }

    // 睡眠的产出全部留在 sleep_runs 这条遥测里，不再写回行动记忆。
    const report: MemoryV2SleepReport = {
      ...baseReport,
      consolidation,
      decay: { scanned: decay.scanned, archived: decay.archivedIds.length },
      embeddingBackfill,
      pipeline: {
        autoMemory: {
          scanned: autoMemory.scanned,
          considered: autoMemory.considered,
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
        },
        selfImprovement: {
          scanned: improvements.scanned,
          created: improvements.created.length,
          totalCandidates: improvements.candidates.length,
        },
      },
    };
    return finish({ status: 'success', report });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finish({ status: 'error', error: message, updateLastRun: false });
  }
}

export async function runDueMemoryV2Sleep(): Promise<MemoryV2SleepRun | null> {
  const config = getMemoryV2SleepConfig();
  if (!config.due) return null;
  return runMemoryV2Sleep({ trigger: 'daily' });
}
