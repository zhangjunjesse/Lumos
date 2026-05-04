/**
 * One-shot inbox snapshot for AI consumption: sessions + their latest N
 * messages joined in a single SQL pass. Avoids the AI's "list, then fetch
 * each chat one by one" anti-pattern — caller gets enough context to
 * summarize without further round-trips.
 */

import { getDb } from '@/lib/db/connection';
import type { DbSession } from './db';

export interface InboxSession extends DbSession {
  recent: Array<{
    message_id: string;
    from_user_id: string;
    from_user_name: string;
    created_at: number;
    content_kind: string;
    content_text: string;
  }>;
}

export function getInbox(opts: {
  accountUnb?: string;
  sessionLimit?: number;
  messagesPerChat?: number;
  unreadOnly?: boolean;
} = {}): InboxSession[] {
  const db = getDb();
  const sessLimit = opts.sessionLimit ?? 50;
  const msgsPer = Math.min(50, Math.max(1, opts.messagesPerChat ?? 10));
  const accountFilter = opts.accountUnb ? 'AND account_unb = ?' : '';
  const unreadFilter = opts.unreadOnly ? 'AND unread > 0' : '';
  const sessSql = `
    SELECT * FROM goofish_sessions
    WHERE session_type IN (0,1) ${accountFilter} ${unreadFilter}
    ORDER BY ts DESC LIMIT ?
  `;
  const sessArgs = opts.accountUnb ? [opts.accountUnb, sessLimit] : [sessLimit];
  const sessions = db.prepare(sessSql).all(...sessArgs) as DbSession[];
  if (sessions.length === 0) return [];
  const msgStmt = db.prepare(`
    SELECT message_id, from_user_id, from_user_name, created_at,
           content_kind, content_text
    FROM goofish_messages
    WHERE cid = ? AND content_kind NOT IN ('system','unknown')
    ORDER BY created_at DESC LIMIT ?
  `);
  return sessions.map((s) => ({
    ...s,
    recent: (msgStmt.all(s.cid, msgsPer) as InboxSession['recent']).reverse(),
  }));
}
