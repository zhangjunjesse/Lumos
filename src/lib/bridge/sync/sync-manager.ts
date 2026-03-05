import Database from 'better-sqlite3';

interface SyncBinding {
  id: number;
  lumos_session_id: string;
  platform_chat_id: string;
  platform: string;
  status: 'active' | 'pending' | 'inactive';
}

export class SyncManager {
  private db: Database.Database;
  private seenMessages = new Set<string>();

  constructor(db: Database.Database) {
    this.db = db;
  }

  createBinding(sessionId: string, chatId: string, platform: string): number {
    const now = Date.now();
    const result = this.db.prepare(
      `INSERT INTO session_bindings (lumos_session_id, platform_chat_id, platform, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`
    ).run(sessionId, chatId, platform, now, now);
    return result.lastInsertRowid as number;
  }

  activateBinding(chatId: string): void {
    this.db.prepare(
      `UPDATE session_bindings SET status = 'active', updated_at = ?
       WHERE platform_chat_id = ?`
    ).run(Date.now(), chatId);
  }

  getBinding(sessionId: string): SyncBinding | null {
    return this.db.prepare(
      `SELECT * FROM session_bindings WHERE lumos_session_id = ?`
    ).get(sessionId) as SyncBinding | undefined || null;
  }

  getBindingByChatId(chatId: string): SyncBinding | null {
    return this.db.prepare(
      `SELECT * FROM session_bindings WHERE platform_chat_id = ?`
    ).get(chatId) as SyncBinding | undefined || null;
  }

  isDuplicate(messageId: string): boolean {
    if (this.seenMessages.has(messageId)) return true;
    const log = this.db.prepare('SELECT id FROM message_sync_log WHERE message_id = ?').get(messageId);
    if (log) {
      this.seenMessages.add(messageId);
      return true;
    }
    return false;
  }

  logSync(
    bindingId: string,
    messageId: string,
    source: 'lumos' | 'feishu',
    direction: string,
    status: 'success' | 'failed',
    error?: string
  ): void {
    this.seenMessages.add(messageId);
    this.db.prepare(
      `INSERT INTO message_sync_log
       (binding_id, message_id, source_platform, direction, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(bindingId, messageId, source, direction, status, error || null);
  }

  shouldSync(binding: SyncBinding | null, direction: 'to_channel' | 'from_channel'): boolean {
    if (!binding || binding.status !== 'active') return false;
    if (binding.syncDirection === 'bidirectional') return true;
    if (direction === 'to_channel' && binding.syncDirection === 'lumos_to_channel') return true;
    if (direction === 'from_channel' && binding.syncDirection === 'channel_to_lumos') return true;
    return false;
  }
}
