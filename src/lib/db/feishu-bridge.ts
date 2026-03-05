import { getDb } from './connection';

// ==========================================
// Session Bindings
// ==========================================

export function createSessionBinding(params: {
  lumosSessionId: string;
  platform: string;
  platformChatId: string;
  bindToken?: string;
}): number {
  const db = getDb();
  const now = Date.now();
  const result = db.prepare(
    `INSERT INTO session_bindings (lumos_session_id, platform, platform_chat_id, bind_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(params.lumosSessionId, params.platform, params.platformChatId, params.bindToken || null, now, now);
  return result.lastInsertRowid as number;
}

export function getSessionBinding(lumosSessionId: string, platform: string) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM session_bindings WHERE lumos_session_id = ? AND platform = ?'
  ).get(lumosSessionId, platform) as {
    id: number; lumos_session_id: string; platform: string;
    platform_chat_id: string; bind_token: string | null; status: string;
    created_at: number; updated_at: number;
  } | undefined;
}

export function getSessionBindingByPlatformChat(platform: string, platformChatId: string) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM session_bindings WHERE platform = ? AND platform_chat_id = ?'
  ).get(platform, platformChatId) as {
    id: number; lumos_session_id: string; platform: string;
    platform_chat_id: string; bind_token: string | null; status: string;
    created_at: number; updated_at: number;
  } | undefined;
}

export function updateSessionBindingStatus(id: number, status: 'active' | 'inactive' | 'expired'): void {
  const db = getDb();
  db.prepare('UPDATE session_bindings SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id);
}

export function deleteSessionBinding(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM session_bindings WHERE id = ?').run(id);
}

// ==========================================
// Message Sync Log
// ==========================================

export function recordMessageSync(params: {
  bindingId: number;
  messageId: string;
  sourcePlatform: string;
  direction: 'to_platform' | 'from_platform';
  status: 'success' | 'failed';
  errorMessage?: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO message_sync_log
     (binding_id, message_id, source_platform, direction, status, error_message, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.bindingId,
    params.messageId,
    params.sourcePlatform,
    params.direction,
    params.status,
    params.errorMessage || null,
    Date.now()
  );
}

export function isMessageSynced(messageId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM message_sync_log WHERE message_id = ?'
  ).get(messageId);
  return !!row;
}

export function getSyncStats(bindingId: number) {
  const db = getDb();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as totalMessages,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount,
      MAX(synced_at) as lastSyncAt
    FROM message_sync_log
    WHERE binding_id = ?
  `).get(bindingId) as {
    totalMessages: number;
    successCount: number;
    failedCount: number;
    lastSyncAt: number | null;
  };
  return stats;
}

export function getSessionBindingById(id: number) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM session_bindings WHERE id = ?'
  ).get(id) as {
    id: number; lumos_session_id: string; platform: string;
    platform_chat_id: string; bind_token: string | null; status: string;
    created_at: number; updated_at: number;
  } | undefined;
}

// ==========================================
// Platform Users
// ==========================================

export function upsertPlatformUser(params: {
  platform: string;
  platformUserId: string;
  platformUsername?: string;
  lumosUserId?: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO platform_users (platform, platform_user_id, platform_username, lumos_user_id, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(platform, platform_user_id) DO UPDATE SET
       platform_username = excluded.platform_username,
       lumos_user_id = excluded.lumos_user_id`
  ).run(params.platform, params.platformUserId, params.platformUsername || null, params.lumosUserId || null, Date.now());
}

export function getPlatformUser(platform: string, platformUserId: string) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM platform_users WHERE platform = ? AND platform_user_id = ?'
  ).get(platform, platformUserId) as {
    id: number; platform: string; platform_user_id: string;
    platform_username: string | null; lumos_user_id: string | null;
    created_at: number;
  } | undefined;
}
