/**
 * 网状事件总线 —— 双层：
 * - in-process EventEmitter 负责"唤醒"（实时通知订阅者）
 * - SQLite mesh_message / mesh_message_delivery 负责"可靠 + 可查"（每订阅者一条投递记录）
 *
 * 三类消息共用此投递层（subscriberIds 定向）：
 * - event 广播：topic 自定，subscriberIds=订阅者
 * - 定向任务 agent_task：subscriberIds=[收件人]，带 taskId
 * - 回执 agent_reply：subscriberIds=[原派发者]，带 taskId（配对 task）
 * 持久化函数在调用方 outbox 事务内执行；wake 在事务提交后调用。不 import workflow / team-run。
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
  taskId: string | null
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
 * 持久化一条消息 + 为每个订阅者建投递记录（pending）。返回 messageId。
 * taskId：定向任务/回执用（配对）；普通 event 传 undefined。在调用方 outbox 事务内执行。
 */
export function persistMessage(
  runId: string,
  topic: string,
  payload: unknown,
  from: string,
  subscriberIds: string[],
  taskId?: string,
): string {
  const db = getDb()
  const messageId = `mmsg_${randomUUID()}`
  db.prepare(
    'INSERT INTO mesh_message (id, run_id, topic, payload_json, from_participant, task_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(messageId, runId, topic, JSON.stringify(payload ?? null), from, taskId ?? null)
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

/** 定向任务的原派发者（reply 配对用）。 */
export function findTaskFrom(runId: string, taskId: string): string | null {
  const r = getDb()
    .prepare(
      `SELECT from_participant FROM mesh_message
       WHERE run_id = ? AND task_id = ? AND topic = 'agent_task' ORDER BY created_at LIMIT 1`,
    )
    .get(runId, taskId) as { from_participant: string } | undefined
  return r?.from_participant ?? null
}

/** 列出某 run 全部 pending 投递（按消息时间），供 runtime drain。 */
export function listPendingDeliveries(runId: string): PendingDelivery[] {
  const rows = getDb()
    .prepare(
      `SELECT d.message_id, d.subscriber_id, m.topic, m.run_id, m.payload_json, m.from_participant, m.task_id
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
      task_id: string | null
    }>
  return rows.map((r) => ({
    messageId: r.message_id,
    subscriberId: r.subscriber_id,
    topic: r.topic,
    runId: r.run_id,
    payload: safeParse(r.payload_json),
    from: r.from_participant,
    taskId: r.task_id,
  }))
}

export interface MeshMessageRecord {
  id: string
  topic: string
  payload: unknown
  from: string
  taskId: string | null
  createdAt: string
}

/** 读某 run 全部消息（事件/任务/回执流，按时间）——供作战室消息流展示。 */
export function listAllMessages(runId: string, limit = 500): MeshMessageRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, topic, payload_json, from_participant, task_id, created_at
       FROM mesh_message WHERE run_id = ? ORDER BY rowid DESC LIMIT ?`,
    )
    .all(runId, limit) as Array<{ id: string; topic: string; payload_json: string; from_participant: string; task_id: string | null; created_at: string }>
  return rows
    .map((r) => ({
      id: r.id,
      topic: r.topic,
      payload: safeParse(r.payload_json),
      from: r.from_participant,
      taskId: r.task_id,
      createdAt: r.created_at,
    }))
    .reverse() // 取最近 limit 条再正序：常驻 session 消息跨 cycle 累积，只读端分页防膨胀
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
