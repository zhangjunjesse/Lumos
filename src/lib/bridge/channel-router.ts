import type { ChannelAddress } from './types';
import type Database from 'better-sqlite3';

export interface ChannelBinding {
  id: number;
  platform: string;
  platform_chat_id: string;
  lumos_session_id: string;
  created_at: number;
}

export class ChannelRouter {
  constructor(private db: Database.Database) {}

  async resolve(address: ChannelAddress): Promise<ChannelBinding> {
    const existing = this.db.prepare(`
      SELECT * FROM session_bindings
      WHERE platform = ? AND platform_chat_id = ?
    `).get(address.channelType, address.chatId) as ChannelBinding | undefined;

    if (existing) return existing;

    const sessionId = `bridge_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const now = Date.now();

    const result = this.db.prepare(`
      INSERT INTO session_bindings (lumos_session_id, platform, platform_chat_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, address.channelType, address.chatId, now, now);

    return {
      id: result.lastInsertRowid as number,
      platform: address.channelType,
      platform_chat_id: address.chatId,
      lumos_session_id: sessionId,
      created_at: now,
    };
  }
}
