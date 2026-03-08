import crypto from 'crypto';
import { getDb } from './connection';

export type MemoryIntelligenceTrigger =
  | 'idle'
  | 'session_switch'
  | 'weak_signal'
  | 'manual'
  | 'api'
  | 'post_reply';

export type MemoryIntelligenceOutcome =
  | 'saved'
  | 'no_memory'
  | 'skipped'
  | 'disabled'
  | 'cooldown'
  | 'budget_limited'
  | 'no_context'
  | 'error';

export interface MemoryIntelligenceEventRecord {
  id: string;
  session_id: string;
  trigger: MemoryIntelligenceTrigger;
  outcome: MemoryIntelligenceOutcome;
  reason: string;
  candidate_count: number;
  saved_count: number;
  token_estimate: number;
  should_model: string;
  extract_model: string;
  details: string; // JSON string
  created_at: string;
}

export interface CreateMemoryIntelligenceEventData {
  sessionId?: string;
  trigger: MemoryIntelligenceTrigger;
  outcome: MemoryIntelligenceOutcome;
  reason?: string;
  candidateCount?: number;
  savedCount?: number;
  tokenEstimate?: number;
  shouldModel?: string;
  extractModel?: string;
  details?: Record<string, unknown>;
}

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

export function createMemoryIntelligenceEvent(
  data: CreateMemoryIntelligenceEventData,
): MemoryIntelligenceEventRecord {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = nowSql();
  const details = data.details ? JSON.stringify(data.details) : '{}';

  db.prepare(
    `INSERT INTO memory_intelligence_events
      (id, session_id, trigger, outcome, reason, candidate_count, saved_count, token_estimate, should_model, extract_model, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    (data.sessionId || '').trim(),
    data.trigger,
    data.outcome,
    (data.reason || '').trim(),
    Math.max(0, Math.floor(data.candidateCount || 0)),
    Math.max(0, Math.floor(data.savedCount || 0)),
    Math.max(0, Math.floor(data.tokenEstimate || 0)),
    (data.shouldModel || '').trim(),
    (data.extractModel || '').trim(),
    details,
    now,
  );

  return db.prepare('SELECT * FROM memory_intelligence_events WHERE id = ?').get(id) as MemoryIntelligenceEventRecord;
}

export function listRecentMemoryIntelligenceEvents(limit = 120): MemoryIntelligenceEventRecord[] {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(limit, 500));
  return db.prepare(
    `SELECT * FROM memory_intelligence_events
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(safeLimit) as MemoryIntelligenceEventRecord[];
}

export function getLatestMemoryIntelligenceEventForSession(
  sessionId: string,
): MemoryIntelligenceEventRecord | undefined {
  const db = getDb();
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) return undefined;
  return db.prepare(
    `SELECT * FROM memory_intelligence_events
     WHERE session_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(normalizedSessionId) as MemoryIntelligenceEventRecord | undefined;
}

function nextDay(dayIso: string): string {
  const date = new Date(`${dayIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function countMemoryIntelligenceEventsByDay(dayIso: string): number {
  const db = getDb();
  const normalized = dayIso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return 0;
  const next = nextDay(normalized);
  const row = db.prepare(
    `SELECT COUNT(*) AS count
     FROM memory_intelligence_events
     WHERE created_at >= ? AND created_at < ?`
  ).get(`${normalized} 00:00:00`, `${next} 00:00:00`) as { count: number } | undefined;
  return row?.count || 0;
}

export function listMemoryIntelligenceEventsSince(sinceSql: string): MemoryIntelligenceEventRecord[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM memory_intelligence_events
     WHERE created_at >= ?
     ORDER BY created_at DESC`
  ).all(sinceSql) as MemoryIntelligenceEventRecord[];
}
