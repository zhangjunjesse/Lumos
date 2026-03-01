import { getDb } from './connection';

// ==========================================
// Session Runtime Lock Operations
// ==========================================

/**
 * Acquire an exclusive lock for a session.
 * Uses SQLite's single-writer guarantee: within a transaction, delete expired
 * locks then INSERT. PK conflict = already locked → return false.
 */
export function acquireSessionLock(
  sessionId: string,
  lockId: string,
  owner: string,
  ttlSec: number = 300,
): boolean {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString().replace('T', ' ').split('.')[0];

  const txn = db.transaction(() => {
    db.prepare("DELETE FROM session_runtime_locks WHERE expires_at < ?").run(now);
    try {
      db.prepare(
        'INSERT INTO session_runtime_locks (session_id, lock_id, owner, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(sessionId, lockId, owner, expiresAt, now, now);
      return true;
    } catch {
      return false;
    }
  });

  return txn();
}

/**
 * Renew an existing session lock by extending its expiry.
 */
export function renewSessionLock(
  sessionId: string,
  lockId: string,
  ttlSec: number = 300,
): boolean {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString().replace('T', ' ').split('.')[0];

  const result = db.prepare(
    'UPDATE session_runtime_locks SET expires_at = ?, updated_at = ? WHERE session_id = ? AND lock_id = ?'
  ).run(expiresAt, now, sessionId, lockId);

  return result.changes > 0;
}

/**
 * Release a session lock.
 */
export function releaseSessionLock(sessionId: string, lockId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM session_runtime_locks WHERE session_id = ? AND lock_id = ?'
  ).run(sessionId, lockId);
  return result.changes > 0;
}

/**
 * Update the runtime status of a session.
 */
export function setSessionRuntimeStatus(
  sessionId: string,
  status: string,
  error?: string,
): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare(
    'UPDATE chat_sessions SET runtime_status = ?, runtime_updated_at = ?, runtime_error = ? WHERE id = ?'
  ).run(status, now, error || '', sessionId);
}
