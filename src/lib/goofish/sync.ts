/**
 * Goofish sync — pulls fresh sessions + messages and writes to the local
 * SQLite archive (goofish_sessions / goofish_messages / goofish_msgs_fts).
 *
 * Two-phase pull:
 *   1. chats_fat sidecar gives us the full session list (baseline + WS),
 *      already enriched with peer info / item info / avatars.
 *   2. For each session we fetch a window of recent message history via
 *      history_fat sidecar, in parallel (capped concurrency).
 *
 * The sync is idempotent — message PK is (cid, message_id), session PK is
 * cid. Re-running pulls newer activity and updates read_status without
 * dropping older archived messages.
 */

import { getAuthStatus, listAccountStatuses } from './auth';
import { cookiesPathFor } from './accounts';
import { fetchFatChats, fetchFatHistory } from './fat-history';
import { extractContent } from './messages';
import type { GoofishChatSession, GoofishMessage } from './messages';
import { upsertSessions, upsertMessages, setSyncState, getSyncState, backfillPeerDetails } from './db';

interface SyncOptions {
  /** baseline page size; goofish-cli's lower bound is 5. */
  fetchNum?: number;
  /** WS subscribe seconds; longer = more chats, ~8s is a sweet spot. */
  watchSecs?: number;
  /** Per-session message limit when pulling history. */
  messageLimit?: number;
  /** Max concurrent history calls. */
  concurrency?: number;
  /** Only sync sessions whose ts > since (ms). 0 = all. */
  since?: number;
  /** Sync only this account. If omitted, iterates all known accounts. */
  accountUnb?: string;
}

export interface SyncResult {
  ok: boolean;
  accountUnb: string;
  sessionsTotal: number;
  sessionsSynced: number;
  messagesUpserted: number;
  durationMs: number;
  error?: string;
}

/**
 * Sync ONE account. If accountUnb is given, scopes goofish-cli to that
 * account's HOME directory. Otherwise reads from the legacy single-account
 * location (back-compat).
 */
export async function runSync(opts: SyncOptions = {}): Promise<SyncResult> {
  const start = Date.now();
  const { fetchNum = 100, watchSecs = 8, messageLimit = 30, concurrency = 5, since = 0, accountUnb } = opts;

  const status = await getAuthStatus({ accountUnb }).catch(() => null);
  if (!status?.valid || !status.unb) {
    return {
      ok: false, accountUnb: accountUnb || '', sessionsTotal: 0, sessionsSynced: 0,
      messagesUpserted: 0, durationMs: Date.now() - start, error: 'not logged in',
    };
  }
  const unb = status.unb;
  const cookies = accountUnb ? cookiesPathFor(accountUnb) : undefined;

  const fat = await fetchFatChats(fetchNum, watchSecs, cookies);
  const sessions = fat.sessions
    .filter((s) => s.session_type === 0 || s.session_type === 1)
    .map(toCanonicalSession);
  upsertSessions(unb, sessions);

  const targets = sessions.filter((s) => !since || s.ts >= since);
  let totalMsgs = 0;
  const tasks = targets.map((s) => async () => {
    const msgs = await fetchFatHistory(s.session_id, messageLimit, cookies).catch(() => []);
    if (msgs.length === 0) return;
    const normalized: GoofishMessage[] = msgs.map((m) => ({
      messageId: String(m.message_id || ''),
      fromUserId: String(m.send_user_id || ''),
      fromUserName: String(m.send_user_name || ''),
      receiverUserId: String(m.receiver_user_id || ''),
      createdAt: Number(m.created_at || 0),
      readStatus: Number(m.read_status || 0),
      summary: String(m.summary || ''),
      content: extractContent(m.message || {}),
    }));
    upsertMessages(s.session_id, unb, s.peer_nick, normalized);
    totalMsgs += normalized.length;
  });
  await runWithConcurrency(tasks, concurrency);

  backfillPeerDetails();
  setSyncState('last_sync_ms', String(Date.now()));
  setSyncState(`last_sync_account_${unb}`, String(Date.now()));

  return {
    ok: true, accountUnb: unb, sessionsTotal: sessions.length,
    sessionsSynced: targets.length, messagesUpserted: totalMsgs, durationMs: Date.now() - start,
  };
}

/**
 * Sync ALL known accounts in sequence. Used by the scheduler and any
 * "sync everything now" UI button. Each account contributes its own
 * SyncResult; failures don't stop the loop.
 */
export async function runSyncAllAccounts(opts: Omit<SyncOptions, 'accountUnb'> = {}): Promise<SyncResult[]> {
  const accounts = await listAccountStatuses();
  const results: SyncResult[] = [];
  for (const acc of accounts) {
    if (!acc.valid) {
      results.push({
        ok: false, accountUnb: acc.accountUnb, sessionsTotal: 0, sessionsSynced: 0,
        messagesUpserted: 0, durationMs: 0, error: 'token invalid',
      });
      continue;
    }
    try {
      results.push(await runSync({ ...opts, accountUnb: acc.accountUnb }));
    } catch (err) {
      results.push({
        ok: false, accountUnb: acc.accountUnb, sessionsTotal: 0, sessionsSynced: 0,
        messagesUpserted: 0, durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

function toCanonicalSession(s: import('./fat-history').FatChatSession): GoofishChatSession {
  return {
    session_id: s.session_id,
    peer_nick: s.peer_nick,
    peer_user_id: s.peer_user_id,
    peer_avatar: s.peer_avatar,
    unread: s.unread,
    last_msg: s.last_msg,
    ts: s.ts,
    session_type: s.session_type,
    item_id: s.item_id,
    item_title: s.item_title,
    item_main_pic: s.item_main_pic,
    source: s.source,
  };
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= tasks.length) return;
      try { await tasks[i](); } catch { /* per-task errors don't block others */ }
    }
  });
  await Promise.all(workers);
}

export function getLastSyncMs(): number {
  const v = getSyncState('last_sync_ms');
  return v ? Number(v) : 0;
}
