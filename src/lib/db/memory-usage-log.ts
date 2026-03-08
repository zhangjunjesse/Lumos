import crypto from 'crypto';
import { getDb } from './connection';

export interface MemoryUsageLog {
  id: string;
  memory_id: string;
  session_id: string;
  used_at: string;
  context: string;
}

export function logMemoryUsage(memoryId: string, sessionId: string, context?: string): void {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  db.prepare(
    `INSERT INTO memory_usage_log (id, memory_id, session_id, context)
     VALUES (?, ?, ?, ?)`
  ).run(id, memoryId, sessionId, context || '');
}

export function getMemoryUsageLog(memoryId: string, limit = 50): MemoryUsageLog[] {
  const db = getDb();
  return db.prepare(
    `SELECT * FROM memory_usage_log
     WHERE memory_id = ?
     ORDER BY used_at DESC
     LIMIT ?`
  ).all(memoryId, limit) as MemoryUsageLog[];
}
