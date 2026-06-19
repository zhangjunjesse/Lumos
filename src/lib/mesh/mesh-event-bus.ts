/**
 * 网状事件总线 —— 双层：
 * - in-process EventEmitter 负责"唤醒"（实时通知订阅者）
 * - SQLite mesh_message / mesh_message_delivery 负责"可靠 + 可查"（每订阅者一条投递记录）
 *
 * 持久化函数（persistMessage / markDelivered）应在调用方的 outbox 事务里执行；
 * wake 在事务提交后调用。本模块不 import workflow / team-run。
 */
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { getDb } from '@/lib/db/connection'

export interface MeshEvent {
  id: string
  runId: string
  topic: string
  payload: unknown
  from: string
}

export interface PendingDelivery {
  messageId: string
  subscriberId: string
  topic: string
  runId: string
  payload: unknown
  from: string
}

const g = globalThis as unknown as { __mesh_emitter__?: EventEmitter }
function bus(): EventEmitter {
  if (!g.__mesh_emitter__) {
    const e = new EventEmitter()
    e.setMaxListeners(200)
    g.__mesh_emitter__ = e
  }
  return g.__mesh_emitter__
}

const keyOf = (runId: string, topic: string) => `mesh:${runId}:${topic}`

/**
 * 持久化一条事件 + 为每个订阅者建投递记录（pending）。返回 messageId。
 * 在调用方的 outbox 事务内执行。
 */
export function persistMessage(
  runId: string,
  topic: string,
  payload: unknown,
  from: string,
  subscriberIds: string[],
): string {
  const db = getDb()
  const messageId = `mmsg_${randomUUID()}`
  db.prepare(
    'INSERT INTO mesh_message (id, run_id, topic, payload_json, from_participant) VALUES (?, ?, ?, ?, ?)',
  ).run(messageId, runId, topic, JSON.stringify(payload ?? null), from)
  const ins = db.prepare(
    'INSERT OR IGNORE INTO mesh_message_delivery (message_id, subscriber_id) VALUES (?, ?)',
  )
  for (const sub of subscriberIds) ins.run(messageId, sub)
  return messageId
}

/** in-process 唤醒（事务提交后调用）。 */
export function wake(runId: string, topic: string, event: MeshEvent): void {
  bus().emit(keyOf(runId, topic), event)
}

/** 订阅某 run 的某 topic，返回取消函数。 */
export function subscribe(runId: string, topic: string, listener: (e: MeshEvent) => void): () => void {
  const k = keyOf(runId, topic)
  bus().on(k, listener)
  return () => bus().off(k, listener)
}

/** 标记某订阅者对某消息已消费。 */
export function markDelivered(
  messageId: string,
  subscriberId: string,
  status: 'done' | 'failed' = 'done',
): void {
  getDb()
    .prepare(
      `UPDATE mesh_message_delivery SET status = ?, delivered_at = datetime('now')
       WHERE message_id = ? AND subscriber_id = ?`,
    )
    .run(status, messageId, subscriberId)
}

/** 列出某 run 全部 pending 投递（按消息时间），供 runtime drain。 */
export function listPendingDeliveries(runId: string): PendingDelivery[] {
  const rows = getDb()
    .prepare(
      `SELECT d.message_id, d.subscriber_id, m.topic, m.run_id, m.payload_json, m.from_participant
       FROM mesh_message_delivery d
       JOIN mesh_message m ON m.id = d.message_id
       WHERE m.run_id = ? AND d.status = 'pending'
       ORDER BY m.created_at, d.subscriber_id`,
    )
    .all(runId) as Array<{
      message_id: string
      subscriber_id: string
      topic: string
      run_id: string
      payload_json: string
      from_participant: string
    }>
  return rows.map((r) => ({
    messageId: r.message_id,
    subscriberId: r.subscriber_id,
    topic: r.topic,
    runId: r.run_id,
    payload: safeParse(r.payload_json),
    from: r.from_participant,
  }))
}

export interface MeshMessageRecord {
  id: string
  topic: string
  payload: unknown
  from: string
  createdAt: string
}

/** 读某 run 全部消息（事件流，按时间）——供作战室消息流展示。 */
export function listAllMessages(runId: string): MeshMessageRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, topic, payload_json, from_participant, created_at
       FROM mesh_message WHERE run_id = ? ORDER BY created_at`,
    )
    .all(runId) as Array<{ id: string; topic: string; payload_json: string; from_participant: string; created_at: string }>
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    payload: safeParse(r.payload_json),
    from: r.from_participant,
    createdAt: r.created_at,
  }))
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
