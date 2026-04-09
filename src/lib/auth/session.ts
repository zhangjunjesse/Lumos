/**
 * Session management for Lumos user authentication.
 *
 * Sessions are stored in `lumos_user_sessions` and linked to `lumos_users`.
 * Tokens are 32-byte random hex strings. Sessions expire after 30 days,
 * with automatic renewal when less than 7 days remain.
 */

import crypto from 'crypto';
import { getDb } from '@/lib/db/connection';
import type { LumosUser } from './types';

const SESSION_DAYS = 30;
const RENEWAL_THRESHOLD_DAYS = 7;

function nowISO(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().replace('T', ' ').split('.')[0];
}

/**
 * Create a new session for the given user.
 */
export function createSession(userId: string): { token: string; expiresAt: string } {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = addDays(SESSION_DAYS);

  db.prepare(
    'INSERT INTO lumos_user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
  ).run(token, userId, expiresAt);

  return { token, expiresAt };
}

/**
 * Validate a session token and return the associated user.
 * If the session is valid but nearing expiry (< 7 days), auto-renew.
 * Returns null if the token is invalid or expired.
 */
export function validateSession(token: string): LumosUser | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT s.expires_at AS session_expires_at, u.*
    FROM lumos_user_sessions s
    JOIN lumos_users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token) as (LumosUser & { session_expires_at: string }) | undefined;

  if (!row) return null;

  const now = new Date();
  const expiry = new Date(row.session_expires_at);
  if (expiry <= now) {
    db.prepare('DELETE FROM lumos_user_sessions WHERE token = ?').run(token);
    return null;
  }

  // Auto-renew if within threshold
  const msRemaining = expiry.getTime() - now.getTime();
  const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
  if (daysRemaining < RENEWAL_THRESHOLD_DAYS) {
    const newExpiry = addDays(SESSION_DAYS);
    db.prepare(
      'UPDATE lumos_user_sessions SET expires_at = ? WHERE token = ?',
    ).run(newExpiry, token);
  }

  // Strip the session-level field before returning user
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { session_expires_at: _, ...user } = row;
  return user as LumosUser;
}

/**
 * Destroy a session (logout).
 */
export function destroySession(token: string): void {
  const db = getDb();
  db.prepare('DELETE FROM lumos_user_sessions WHERE token = ?').run(token);
}

/**
 * Remove all expired sessions from the database.
 */
export function cleanExpiredSessions(): void {
  const db = getDb();
  db.prepare(
    'DELETE FROM lumos_user_sessions WHERE expires_at <= ?',
  ).run(nowISO());
}
