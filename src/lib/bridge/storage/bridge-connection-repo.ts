import { getDb } from '@/lib/db';

export type BridgeTransportStatus = 'starting' | 'connected' | 'reconnecting' | 'disconnected' | 'stale';
export type BridgeTransportKind = 'websocket' | 'webhook' | 'polling';

export interface BridgeConnectionRecord {
  platform: string;
  account_id: string;
  transport_kind: BridgeTransportKind;
  status: BridgeTransportStatus;
  last_connected_at: number | null;
  last_disconnected_at: number | null;
  last_event_at: number | null;
  last_error_at: number | null;
  last_error_message: string | null;
  created_at: number;
  updated_at: number;
}

interface UpsertBridgeConnectionInput {
  platform: string;
  accountId?: string;
  transportKind: BridgeTransportKind;
  status: BridgeTransportStatus;
  lastConnectedAt?: number | null;
  lastDisconnectedAt?: number | null;
  lastEventAt?: number | null;
  lastErrorAt?: number | null;
  lastErrorMessage?: string | null;
}

export function upsertBridgeConnection(input: UpsertBridgeConnectionInput): BridgeConnectionRecord {
  const db = getDb();
  const now = Date.now();
  const accountId = input.accountId || 'default';
  const current = getBridgeConnection(input.platform, accountId, input.transportKind);

  const lastConnectedAt = input.lastConnectedAt === undefined
    ? current?.last_connected_at ?? null
    : input.lastConnectedAt;
  const lastDisconnectedAt = input.lastDisconnectedAt === undefined
    ? current?.last_disconnected_at ?? null
    : input.lastDisconnectedAt;
  const lastEventAt = input.lastEventAt === undefined
    ? current?.last_event_at ?? null
    : input.lastEventAt;
  const lastErrorAt = input.lastErrorAt === undefined
    ? current?.last_error_at ?? null
    : input.lastErrorAt;
  const lastErrorMessage = input.lastErrorMessage === undefined
    ? current?.last_error_message ?? null
    : input.lastErrorMessage;

  db.prepare(
    `INSERT INTO bridge_connections (
       platform,
       account_id,
       transport_kind,
       status,
       last_connected_at,
       last_disconnected_at,
       last_event_at,
       last_error_at,
       last_error_message,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform, account_id, transport_kind) DO UPDATE SET
       status = excluded.status,
       last_connected_at = excluded.last_connected_at,
       last_disconnected_at = excluded.last_disconnected_at,
       last_event_at = excluded.last_event_at,
       last_error_at = excluded.last_error_at,
       last_error_message = excluded.last_error_message,
       updated_at = excluded.updated_at`
  ).run(
    input.platform,
    accountId,
    input.transportKind,
    input.status,
    lastConnectedAt,
    lastDisconnectedAt,
    lastEventAt,
    lastErrorAt,
    lastErrorMessage,
    now,
    now,
  );

  return getBridgeConnection(input.platform, accountId, input.transportKind)!;
}

export function touchBridgeConnectionEvent(params: {
  platform: string;
  accountId?: string;
  transportKind: BridgeTransportKind;
  at?: number;
}): void {
  const db = getDb();
  const now = params.at ?? Date.now();
  db.prepare(
    `UPDATE bridge_connections
       SET last_event_at = ?, updated_at = ?
     WHERE platform = ? AND account_id = ? AND transport_kind = ?`
  ).run(now, now, params.platform, params.accountId || 'default', params.transportKind);
}

export function recordBridgeConnectionError(params: {
  platform: string;
  accountId?: string;
  transportKind: BridgeTransportKind;
  errorMessage: string;
  at?: number;
}): void {
  const db = getDb();
  const now = params.at ?? Date.now();
  db.prepare(
    `UPDATE bridge_connections
       SET last_error_at = ?, last_error_message = ?, updated_at = ?
     WHERE platform = ? AND account_id = ? AND transport_kind = ?`
  ).run(now, params.errorMessage, now, params.platform, params.accountId || 'default', params.transportKind);
}

export function getBridgeConnection(
  platform: string,
  accountId = 'default',
  transportKind?: BridgeTransportKind,
): BridgeConnectionRecord | null {
  const db = getDb();
  const row = transportKind
    ? db.prepare(
        `SELECT * FROM bridge_connections
         WHERE platform = ? AND account_id = ? AND transport_kind = ?`
      ).get(platform, accountId, transportKind)
    : db.prepare(
        `SELECT * FROM bridge_connections
         WHERE platform = ? AND account_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      ).get(platform, accountId);
  return (row as BridgeConnectionRecord | undefined) || null;
}
