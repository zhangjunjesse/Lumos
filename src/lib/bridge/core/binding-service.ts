import { getDb } from '@/lib/db';
import type Database from 'better-sqlite3';

export type BridgePlatform = 'feishu';
export type BridgeBindingStatus = 'active' | 'inactive' | 'expired' | 'deleted' | 'pending';

export interface BridgeBindingRecord {
  id: number;
  sessionId: string;
  platform: string;
  channelId: string;
  channelName: string;
  shareLink: string;
  status: BridgeBindingStatus;
  createdAt: number;
  updatedAt: number;
}

export interface BridgeSyncStats {
  totalMessages: number;
  successCount: number;
  failedCount: number;
  lastSyncAt: number | null;
}

interface CreateBindingInput {
  sessionId: string;
  platform: BridgePlatform;
  channelId: string;
  channelName?: string;
  shareLink?: string;
  status?: Exclude<BridgeBindingStatus, 'deleted'>;
}

interface SyncHealthSummary {
  lastInboundSuccessAt: number | null;
  lastInboundFailureAt: number | null;
  lastOutboundSuccessAt: number | null;
  lastOutboundFailureAt: number | null;
  consecutiveInboundFailures: number;
  consecutiveOutboundFailures: number;
}

type BindingRow = {
  id: number;
  lumos_session_id: string;
  platform: string;
  platform_chat_id: string;
  platform_chat_name?: string;
  share_link?: string;
  status: BridgeBindingStatus;
  created_at: number;
  updated_at: number;
};

type SyncLogRow = {
  direction: 'to_platform' | 'from_platform';
  status: 'success' | 'failed';
  synced_at: number;
};

type BridgeEventHealthRow = {
  direction: 'inbound' | 'outbound';
  status: 'received' | 'processing' | 'success' | 'failed' | 'dead_letter';
  updated_at: number;
};

function ensureBindingMetadataColumns(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(session_bindings)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('platform_chat_name')) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN platform_chat_name TEXT NOT NULL DEFAULT ''");
  }

  if (!names.has('share_link')) {
    db.exec("ALTER TABLE session_bindings ADD COLUMN share_link TEXT NOT NULL DEFAULT ''");
  }
}

function mapBinding(row: BindingRow | undefined): BridgeBindingRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.lumos_session_id,
    platform: row.platform,
    channelId: row.platform_chat_id,
    channelName: row.platform_chat_name || '',
    shareLink: row.share_link || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class BindingService {
  private getDb(): Database.Database {
    const db = getDb();
    ensureBindingMetadataColumns(db);
    return db;
  }

  private pruneOrphanBindings(
    db: Database.Database,
    filters?: { sessionId?: string; platform?: BridgePlatform; channelId?: string },
  ): void {
    const conditions = [
      "sb.status != 'deleted'",
      'cs.id IS NULL',
    ];
    const args: Array<string> = [];

    if (filters?.sessionId) {
      conditions.push('sb.lumos_session_id = ?');
      args.push(filters.sessionId);
    }
    if (filters?.platform) {
      conditions.push('sb.platform = ?');
      args.push(filters.platform);
    }
    if (filters?.channelId) {
      conditions.push('sb.platform_chat_id = ?');
      args.push(filters.channelId);
    }

    const orphanIds = db.prepare(
      `SELECT sb.id
       FROM session_bindings sb
       LEFT JOIN chat_sessions cs ON cs.id = sb.lumos_session_id
       WHERE ${conditions.join(' AND ')}`
    ).all(...args) as Array<{ id: number }>;

    if (orphanIds.length === 0) return;

    const now = Date.now();
    const placeholders = orphanIds.map(() => '?').join(', ');
    db.prepare(
      `UPDATE session_bindings
         SET status = 'deleted', updated_at = ?
       WHERE id IN (${placeholders})`
    ).run(now, ...orphanIds.map((row) => row.id));

    console.warn('[BridgeBinding] Pruned orphan bindings', {
      bindingIds: orphanIds.map((row) => row.id),
      sessionId: filters?.sessionId || null,
      platform: filters?.platform || null,
      channelId: filters?.channelId || null,
    });
  }

  listBindings(sessionId: string, platform?: BridgePlatform): BridgeBindingRecord[] {
    const db = this.getDb();
    this.pruneOrphanBindings(db, { sessionId, platform });
    const rows = platform
      ? db.prepare(
          `SELECT * FROM session_bindings
           WHERE lumos_session_id = ? AND platform = ? AND status != 'deleted'
           ORDER BY updated_at DESC, id DESC`
        ).all(sessionId, platform)
      : db.prepare(
          `SELECT * FROM session_bindings
           WHERE lumos_session_id = ? AND status != 'deleted'
           ORDER BY updated_at DESC, id DESC`
        ).all(sessionId);
    return (rows as BindingRow[]).map((row) => mapBinding(row)!).filter(Boolean);
  }

  getBindingById(bindingId: number): BridgeBindingRecord | null {
    const db = this.getDb();
    this.pruneOrphanBindings(db);
    const row = db.prepare('SELECT * FROM session_bindings WHERE id = ?').get(bindingId) as BindingRow | undefined;
    return mapBinding(row);
  }

  getActiveBinding(sessionId: string, platform: BridgePlatform): BridgeBindingRecord | null {
    const db = this.getDb();
    this.pruneOrphanBindings(db, { sessionId, platform });
    const row = db.prepare(
      `SELECT * FROM session_bindings
       WHERE lumos_session_id = ? AND platform = ? AND status = 'active'
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    ).get(sessionId, platform) as BindingRow | undefined;
    return mapBinding(row);
  }

  getLatestBinding(sessionId: string, platform: BridgePlatform): BridgeBindingRecord | null {
    const db = this.getDb();
    this.pruneOrphanBindings(db, { sessionId, platform });
    const row = db.prepare(
      `SELECT * FROM session_bindings
       WHERE lumos_session_id = ? AND platform = ? AND status != 'deleted'
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    ).get(sessionId, platform) as BindingRow | undefined;
    return mapBinding(row);
  }

  getBindingByChannel(platform: BridgePlatform, channelId: string): BridgeBindingRecord | null {
    const db = this.getDb();
    this.pruneOrphanBindings(db, { platform, channelId });
    const row = db.prepare(
      `SELECT * FROM session_bindings
       WHERE platform = ? AND platform_chat_id = ? AND status != 'deleted'
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    ).get(platform, channelId) as BindingRow | undefined;
    return mapBinding(row);
  }

  createBinding(input: CreateBindingInput): BridgeBindingRecord {
    const db = this.getDb();
    const now = Date.now();
    const result = db.prepare(
      `INSERT INTO session_bindings (
         lumos_session_id,
         platform,
         platform_chat_id,
         platform_chat_name,
         share_link,
         status,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.sessionId,
      input.platform,
      input.channelId,
      input.channelName || '',
      input.shareLink || '',
      input.status || 'active',
      now,
      now,
    );
    return this.getBindingById(result.lastInsertRowid as number)!;
  }

  updateBindingMetadata(bindingId: number, updates: { channelName?: string; shareLink?: string }): BridgeBindingRecord | null {
    const db = this.getDb();
    const current = this.getBindingById(bindingId);
    if (!current) return null;
    db.prepare(
      `UPDATE session_bindings
         SET platform_chat_name = ?, share_link = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      updates.channelName ?? current.channelName,
      updates.shareLink ?? current.shareLink,
      Date.now(),
      bindingId,
    );
    return this.getBindingById(bindingId);
  }

  updateBindingStatus(bindingId: number, status: 'active' | 'inactive' | 'expired'): BridgeBindingRecord | null {
    const db = this.getDb();
    db.prepare(
      'UPDATE session_bindings SET status = ?, updated_at = ? WHERE id = ?'
    ).run(status, Date.now(), bindingId);
    return this.getBindingById(bindingId);
  }

  softDeleteBinding(bindingId: number): void {
    const db = this.getDb();
    db.prepare(
      'UPDATE session_bindings SET status = ?, updated_at = ? WHERE id = ?'
    ).run('deleted', Date.now(), bindingId);
  }

  getSyncStats(bindingId: number): BridgeSyncStats {
    const db = this.getDb();
    const stats = db.prepare(`
      SELECT
        COUNT(*) as totalMessages,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successCount,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount,
        MAX(synced_at) as lastSyncAt
      FROM message_sync_log
      WHERE binding_id = ?
    `).get(bindingId) as {
      totalMessages: number | null;
      successCount: number | null;
      failedCount: number | null;
      lastSyncAt: number | null;
    };

    return {
      totalMessages: stats.totalMessages || 0,
      successCount: stats.successCount || 0,
      failedCount: stats.failedCount || 0,
      lastSyncAt: stats.lastSyncAt ?? null,
    };
  }

  getSyncHealthSummary(bindingId: number): SyncHealthSummary {
    const db = this.getDb();
    const latestEvents = db.prepare(`
      SELECT
        MAX(CASE WHEN direction = 'inbound' AND status = 'success' THEN updated_at END) AS lastInboundSuccessAt,
        MAX(CASE WHEN direction = 'inbound' AND status = 'failed' THEN updated_at END) AS lastInboundFailureAt,
        MAX(CASE WHEN direction = 'outbound' AND status = 'success' THEN updated_at END) AS lastOutboundSuccessAt,
        MAX(CASE WHEN direction = 'outbound' AND status = 'failed' THEN updated_at END) AS lastOutboundFailureAt
      FROM bridge_events
      WHERE binding_id = ?
    `).get(bindingId) as {
      lastInboundSuccessAt: number | null;
      lastInboundFailureAt: number | null;
      lastOutboundSuccessAt: number | null;
      lastOutboundFailureAt: number | null;
    };

    const latestLegacy = db.prepare(`
      SELECT
        MAX(CASE WHEN direction = 'from_platform' AND status = 'success' THEN synced_at END) AS lastInboundSuccessAt,
        MAX(CASE WHEN direction = 'from_platform' AND status = 'failed' THEN synced_at END) AS lastInboundFailureAt,
        MAX(CASE WHEN direction = 'to_platform' AND status = 'success' THEN synced_at END) AS lastOutboundSuccessAt,
        MAX(CASE WHEN direction = 'to_platform' AND status = 'failed' THEN synced_at END) AS lastOutboundFailureAt
      FROM message_sync_log
      WHERE binding_id = ?
    `).get(bindingId) as {
      lastInboundSuccessAt: number | null;
      lastInboundFailureAt: number | null;
      lastOutboundSuccessAt: number | null;
      lastOutboundFailureAt: number | null;
    };

    const recentEvents = db.prepare(
      `SELECT direction, status, updated_at
       FROM bridge_events
       WHERE binding_id = ?
       ORDER BY updated_at DESC
       LIMIT 50`
    ).all(bindingId) as BridgeEventHealthRow[];

    const recentLegacy = db.prepare(
      `SELECT direction, status, synced_at
       FROM message_sync_log
       WHERE binding_id = ?
       ORDER BY synced_at DESC
       LIMIT 50`
    ).all(bindingId) as SyncLogRow[];

    let consecutiveInboundFailures = 0;
    let inboundSettled = false;
    let consecutiveOutboundFailures = 0;
    let outboundSettled = false;

    for (const row of recentEvents) {
      if (row.direction === 'inbound' && !inboundSettled) {
        if (row.status === 'failed') {
          consecutiveInboundFailures += 1;
        } else if (row.status === 'success') {
          inboundSettled = true;
        }
      }
      if (row.direction === 'outbound' && !outboundSettled) {
        if (row.status === 'failed') {
          consecutiveOutboundFailures += 1;
        } else if (row.status === 'success') {
          outboundSettled = true;
        }
      }
      if (inboundSettled && outboundSettled) break;
    }

    for (const row of recentLegacy) {
      if (row.direction === 'from_platform' && !inboundSettled) {
        if (row.status === 'failed') {
          consecutiveInboundFailures += 1;
        } else {
          inboundSettled = true;
        }
      }
      if (row.direction === 'to_platform' && !outboundSettled) {
        if (row.status === 'failed') {
          consecutiveOutboundFailures += 1;
        } else {
          outboundSettled = true;
        }
      }
      if (inboundSettled && outboundSettled) break;
    }

    return {
      lastInboundSuccessAt: latestEvents.lastInboundSuccessAt ?? latestLegacy.lastInboundSuccessAt ?? null,
      lastInboundFailureAt: latestEvents.lastInboundFailureAt ?? latestLegacy.lastInboundFailureAt ?? null,
      lastOutboundSuccessAt: latestEvents.lastOutboundSuccessAt ?? latestLegacy.lastOutboundSuccessAt ?? null,
      lastOutboundFailureAt: latestEvents.lastOutboundFailureAt ?? latestLegacy.lastOutboundFailureAt ?? null,
      consecutiveInboundFailures,
      consecutiveOutboundFailures,
    };
  }

  listActiveBindings(platform?: BridgePlatform): BridgeBindingRecord[] {
    const db = this.getDb();
    this.pruneOrphanBindings(db, { platform });
    const rows = platform
      ? db.prepare(
          `SELECT * FROM session_bindings
           WHERE platform = ? AND status = 'active'
           ORDER BY updated_at DESC, id DESC`
        ).all(platform)
      : db.prepare(
          `SELECT * FROM session_bindings
           WHERE status = 'active'
           ORDER BY updated_at DESC, id DESC`
        ).all();
    return (rows as BindingRow[]).map((row) => mapBinding(row)!).filter(Boolean);
  }
}
