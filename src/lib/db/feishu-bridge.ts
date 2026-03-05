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
  lumosMessageId?: string;
  platform: string;
  platformMessageId: string;
  direction: 'to_platform' | 'from_platform';
}): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO message_sync_log (lumos_message_id, platform, platform_message_id, direction, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(params.lumosMessageId || null, params.platform, params.platformMessageId, params.direction, Date.now());
}

export function isMessageSynced(platform: string, platformMessageId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM message_sync_log WHERE platform = ? AND platform_message_id = ?'
  ).get(platform, platformMessageId);
  return !!row;
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
