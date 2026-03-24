import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';

export type BridgeEventDirection = 'inbound' | 'outbound';
export type BridgeEventTransportKind = 'websocket' | 'webhook' | 'polling' | 'rest';
export type BridgeEventType = 'message' | 'file' | 'image' | 'audio' | 'video' | 'system';
export type BridgeEventStatus = 'received' | 'processing' | 'success' | 'failed' | 'dead_letter';

export interface BridgeEventRecord {
  id: string;
  binding_id: number;
  platform: string;
  direction: BridgeEventDirection;
  transport_kind: BridgeEventTransportKind;
  channel_id: string;
  platform_account_id: string;
  platform_message_id: string;
  event_type: BridgeEventType;
  status: BridgeEventStatus;
  payload_json: string;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  last_attempt_at: number | null;
  created_at: number;
  updated_at: number;
}

interface RecordBridgeEventInput {
  bindingId: number;
  platform: string;
  direction: BridgeEventDirection;
  transportKind: BridgeEventTransportKind;
  channelId: string;
  platformAccountId?: string;
  platformMessageId?: string;
  eventType: BridgeEventType;
  status: BridgeEventStatus;
  payload?: unknown;
  errorCode?: string;
  errorMessage?: string;
  retryCount?: number;
  lastAttemptAt?: number | null;
}

interface BridgeEventLookup {
  platform: string;
  direction: BridgeEventDirection;
  channelId: string;
  platformMessageId: string;
}

interface ListBridgeEventsInput {
  bindingId?: number;
  direction?: BridgeEventDirection;
  statuses: BridgeEventStatus[];
  updatedBefore: number;
  limit?: number;
}

export function recordBridgeEvent(input: RecordBridgeEventInput): BridgeEventRecord {
  const db = getDb();
  const now = Date.now();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO bridge_events (
       id,
       binding_id,
       platform,
       direction,
       transport_kind,
       channel_id,
       platform_account_id,
       platform_message_id,
       event_type,
       status,
       payload_json,
       error_code,
       error_message,
       retry_count,
       last_attempt_at,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.bindingId,
    input.platform,
    input.direction,
    input.transportKind,
    input.channelId,
    input.platformAccountId || 'default',
    input.platformMessageId || '',
    input.eventType,
    input.status,
    JSON.stringify(input.payload ?? {}),
    input.errorCode || null,
    input.errorMessage || null,
    input.retryCount ?? 0,
    input.lastAttemptAt ?? null,
    now,
    now,
  );

  return db.prepare('SELECT * FROM bridge_events WHERE id = ?').get(id) as BridgeEventRecord;
}

export function findBridgeEventByPlatformMessage(input: BridgeEventLookup): BridgeEventRecord | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM bridge_events
     WHERE platform = ? AND direction = ? AND channel_id = ? AND platform_message_id = ?
     LIMIT 1`
  ).get(input.platform, input.direction, input.channelId, input.platformMessageId);
  return (row as BridgeEventRecord | undefined) || null;
}

export function getBridgeEventById(id: string): BridgeEventRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM bridge_events WHERE id = ?').get(id);
  return (row as BridgeEventRecord | undefined) || null;
}

export function updateBridgeEvent(params: {
  id: string;
  status?: BridgeEventStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  payload?: unknown;
  retryCount?: number;
  lastAttemptAt?: number | null;
}): BridgeEventRecord | null {
  const current = getBridgeEventById(params.id);
  if (!current) return null;

  const db = getDb();
  db.prepare(
    `UPDATE bridge_events
       SET status = ?,
           error_code = ?,
           error_message = ?,
           payload_json = ?,
           retry_count = ?,
           last_attempt_at = ?,
           updated_at = ?
     WHERE id = ?`
  ).run(
    params.status ?? current.status,
    params.errorCode === undefined ? current.error_code : params.errorCode,
    params.errorMessage === undefined ? current.error_message : params.errorMessage,
    params.payload === undefined ? current.payload_json : JSON.stringify(params.payload ?? {}),
    params.retryCount ?? current.retry_count,
    params.lastAttemptAt === undefined ? current.last_attempt_at : params.lastAttemptAt,
    Date.now(),
    params.id,
  );

  return getBridgeEventById(params.id);
}

export function getLatestRetryableInboundEvent(bindingId: number): BridgeEventRecord | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM bridge_events
     WHERE binding_id = ?
       AND direction = 'inbound'
       AND status IN ('failed', 'dead_letter')
     ORDER BY updated_at DESC
     LIMIT 1`
  ).get(bindingId);
  return (row as BridgeEventRecord | undefined) || null;
}

export function getLatestRecoverableInboundEvent(
  bindingId: number,
  options?: {
    staleReceivedBefore?: number | null;
    staleProcessingBefore?: number | null;
  },
): BridgeEventRecord | null {
  const db = getDb();
  const staleReceivedBefore = options?.staleReceivedBefore ?? null;
  const staleProcessingBefore = options?.staleProcessingBefore ?? null;

  const row = staleReceivedBefore === null && staleProcessingBefore === null
    ? db.prepare(
        `SELECT * FROM bridge_events
         WHERE binding_id = ?
           AND direction = 'inbound'
           AND status IN ('failed', 'dead_letter')
         ORDER BY updated_at DESC
         LIMIT 1`
      ).get(bindingId)
    : db.prepare(
        `SELECT * FROM bridge_events
         WHERE binding_id = ?
           AND direction = 'inbound'
           AND (
             status IN ('failed', 'dead_letter')
             OR (status = 'received' AND updated_at <= ?)
             OR (status = 'processing' AND updated_at <= ?)
           )
         ORDER BY updated_at DESC
         LIMIT 1`
      ).get(
        bindingId,
        staleReceivedBefore ?? 0,
        staleProcessingBefore ?? 0,
      );

  return (row as BridgeEventRecord | undefined) || null;
}

export function listBridgeEvents(input: ListBridgeEventsInput): BridgeEventRecord[] {
  const db = getDb();
  const placeholders = input.statuses.map(() => '?').join(', ');
  const sql = [
    'SELECT * FROM bridge_events',
    'WHERE updated_at <= ?',
    input.bindingId === undefined ? '' : 'AND binding_id = ?',
    input.direction === undefined ? '' : 'AND direction = ?',
    `AND status IN (${placeholders})`,
    'ORDER BY updated_at ASC',
    'LIMIT ?',
  ].filter(Boolean).join(' ');

  const args: Array<number | string> = [input.updatedBefore];
  if (input.bindingId !== undefined) {
    args.push(input.bindingId);
  }
  if (input.direction !== undefined) {
    args.push(input.direction);
  }
  args.push(...input.statuses);
  args.push(input.limit ?? 20);

  return db.prepare(sql).all(...args) as BridgeEventRecord[];
}
