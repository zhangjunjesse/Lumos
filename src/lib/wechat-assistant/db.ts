import { randomUUID } from 'node:crypto';

import { getDb } from '@/lib/db';

import type {
  ManualTodoInput,
  TodoFollowupType,
  TodoStatus,
  WeChatAssistantRun,
  WeChatEvent,
  WeChatEventInput,
  WeChatTodo,
  WeChatTodoSuggestionInput,
} from './ai-types';
import {
  mapEvent,
  mapRun,
  mapTodo,
  type EventRow,
  type RunRow,
  type TodoRow,
} from './db-mappers';
import {
  displayWechatName,
  safeSanitizedWechatText,
  sanitizeWechatText,
} from './wechat-text';

// ─── Runs ─────────────────────────────────────────────────────────────

export function createRun(input: {
  snapshotHash: string;
  providerId: string | null;
  model: string | null;
  messagesScanned: number;
}): WeChatAssistantRun {
  const id = randomUUID();
  const startedAt = Date.now();
  getDb().prepare(`
    INSERT INTO wechat_assistant_runs
      (id, snapshot_hash, provider_id, model, started_at, status, messages_scanned)
    VALUES (?, ?, ?, ?, ?, 'running', ?)
  `).run(id, input.snapshotHash, input.providerId, input.model, startedAt, input.messagesScanned);
  return {
    id,
    snapshotHash: input.snapshotHash,
    providerId: input.providerId,
    model: input.model,
    startedAt,
    finishedAt: null,
    status: 'running',
    message: null,
    eventsCount: 0,
    todosCount: 0,
    tokensIn: null,
    tokensOut: null,
    messagesScanned: input.messagesScanned,
  };
}

export function markRunDone(
  id: string,
  meta: { eventsCount: number; todosCount: number; tokensIn?: number; tokensOut?: number },
): void {
  getDb().prepare(`
    UPDATE wechat_assistant_runs
       SET finished_at = ?, status = 'done',
           events_count = ?, todos_count = ?,
           tokens_in = ?, tokens_out = ?
     WHERE id = ?
  `).run(
    Date.now(),
    meta.eventsCount,
    meta.todosCount,
    meta.tokensIn ?? null,
    meta.tokensOut ?? null,
    id,
  );
}

export function markRunFailed(id: string, message: string): void {
  getDb().prepare(`
    UPDATE wechat_assistant_runs
       SET finished_at = ?, status = 'failed', message = ?
     WHERE id = ?
  `).run(Date.now(), message, id);
}

export function getLatestRun(): WeChatAssistantRun | null {
  const row = getDb().prepare(`
    SELECT * FROM wechat_assistant_runs
     WHERE status = 'done'
     ORDER BY finished_at DESC
     LIMIT 1
  `).get() as RunRow | undefined;
  return row ? mapRun(row) : null;
}

// ─── Events ───────────────────────────────────────────────────────────

export function insertEvents(runId: string, inputs: WeChatEventInput[]): WeChatEvent[] {
  const stmt = getDb().prepare(`
    INSERT INTO wechat_assistant_events
      (id, run_id, title, urgency, contact_wxid, contact_display, is_group,
       evidence_msg_ids_json, evidence_texts_json, suggested_action, last_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const out: WeChatEvent[] = [];
  const now = Date.now();
  for (const item of inputs) {
    const id = randomUUID();
    stmt.run(
      id, runId, item.title, item.urgency, item.contactWxid, item.contactDisplay,
      item.isGroup ? 1 : 0,
      JSON.stringify(item.evidenceMsgIds),
      JSON.stringify(item.evidenceTexts),
      item.suggestedAction,
      item.lastAt,
      now,
    );
    out.push({ ...item, id, runId, createdAt: now });
  }
  return out;
}

export function listEventsByRun(runId: string): WeChatEvent[] {
  const rows = getDb().prepare(`
    SELECT * FROM wechat_assistant_events
     WHERE run_id = ?
     ORDER BY
       CASE urgency WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
       last_at DESC
  `).all(runId) as EventRow[];
  return rows.map(mapEvent);
}

// ─── Todos ────────────────────────────────────────────────────────────

export function insertTodoSuggestions(
  runId: string,
  inputs: WeChatTodoSuggestionInput[],
): WeChatTodo[] {
  const stmt = getDb().prepare(`
    INSERT INTO wechat_assistant_todos
      (id, run_id, text, source, source_msg_id, source_text, source_display, source_sender_display, source_wxid,
       involved_wxids_json, by_when_text, summary, next_step, followup_type, due_at,
       confidence, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?)
  `);
  const out: WeChatTodo[] = [];
  const now = Date.now();
  for (const item of inputs) {
    const id = randomUUID();
    const normalized = normalizeTodoSuggestion(item);
    const involvedWxids = normalizeInvolvedWxids([], item.sourceWxid);
    stmt.run(
      id, runId, normalized.text, item.source, item.sourceMsgId, normalized.sourceText,
      normalized.sourceDisplay, normalized.sourceSenderDisplay ?? null, item.sourceWxid, JSON.stringify(involvedWxids),
      normalized.byWhenText, summarizeTodoSuggestion(normalized),
      normalized.byWhenText, inferFollowupType(item.source), item.dueAt, item.confidence, now,
    );
    out.push({
      id, runId,
      text: normalized.text,
      source: item.source,
      sourceMsgId: item.sourceMsgId,
      sourceText: normalized.sourceText,
      sourceDisplay: normalized.sourceDisplay,
      sourceSenderDisplay: normalized.sourceSenderDisplay ?? null,
      sourceWxid: item.sourceWxid,
      involvedWxids,
      byWhenText: normalized.byWhenText,
      summary: summarizeTodoSuggestion(normalized),
      nextStep: normalized.byWhenText,
      followupType: inferFollowupType(item.source),
      dueAt: item.dueAt,
      remindAt: null,
      confidence: item.confidence,
      status: 'suggested',
      createdAt: now,
      confirmedAt: null,
      doneAt: null,
    });
  }
  return out;
}

export function addManualTodo(input: ManualTodoInput): WeChatTodo {
  const id = randomUUID();
  const now = Date.now();
  const involvedWxids = normalizeInvolvedWxids(input.involvedWxids ?? [], input.sourceWxid ?? null);
  const sourceWxid = input.sourceWxid ?? involvedWxids[0] ?? null;
  getDb().prepare(`
    INSERT INTO wechat_assistant_todos
      (id, run_id, text, source, source_display, source_wxid, involved_wxids_json, by_when_text,
       summary, next_step, followup_type, due_at, remind_at, status, created_at, confirmed_at)
    VALUES (?, NULL, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    id,
    input.text,
    input.sourceDisplay ?? null,
    sourceWxid,
    JSON.stringify(involvedWxids),
    input.byWhenText ?? null,
    input.summary ?? null,
    input.nextStep ?? input.byWhenText ?? null,
    input.followupType ?? 'other',
    input.dueAt ?? null,
    input.remindAt ?? null,
    now,
    now,
  );
  const row = getDb()
    .prepare(`SELECT * FROM wechat_assistant_todos WHERE id = ?`)
    .get(id) as TodoRow;
  return mapTodo(row);
}

export function listTodos(opts: { status?: TodoStatus | TodoStatus[] } = {}): WeChatTodo[] {
  const statuses = opts.status
    ? Array.isArray(opts.status) ? opts.status : [opts.status]
    : null;
  const where = statuses ? `WHERE status IN (${statuses.map(() => '?').join(',')})` : '';
  const rows = getDb().prepare(`
    SELECT * FROM wechat_assistant_todos
     ${where}
     ORDER BY
       CASE status
         WHEN 'open' THEN 0
         WHEN 'in_progress' THEN 1
         WHEN 'suggested' THEN 2
         WHEN 'done' THEN 3
         ELSE 4
       END,
       COALESCE(due_at, 99999999999) ASC,
       created_at DESC
  `).all(...(statuses ?? [])) as TodoRow[];
  return rows.map(mapTodo);
}

export function setTodoStatus(
  id: string,
  status: TodoStatus,
  extras?: { dueAt?: number | null; remindAt?: number | null },
): WeChatTodo | null {
  const now = Date.now();
  if (status === 'open') {
    getDb().prepare(`
      UPDATE wechat_assistant_todos
         SET status = 'open', confirmed_at = COALESCE(confirmed_at, ?),
             due_at = COALESCE(?, due_at),
             remind_at = COALESCE(?, remind_at),
             done_at = NULL
       WHERE id = ?
    `).run(now, extras?.dueAt ?? null, extras?.remindAt ?? null, id);
  } else if (status === 'in_progress') {
    getDb().prepare(`
      UPDATE wechat_assistant_todos
         SET status = 'in_progress', confirmed_at = COALESCE(confirmed_at, ?),
             due_at = COALESCE(?, due_at),
             remind_at = COALESCE(?, remind_at),
             done_at = NULL
       WHERE id = ?
    `).run(now, extras?.dueAt ?? null, extras?.remindAt ?? null, id);
  } else if (status === 'done') {
    getDb().prepare(`
      UPDATE wechat_assistant_todos SET status = 'done', done_at = ? WHERE id = ?
    `).run(now, id);
  } else {
    getDb().prepare(`
      UPDATE wechat_assistant_todos SET status = ? WHERE id = ?
    `).run(status, id);
  }
  const row = getDb()
    .prepare(`SELECT * FROM wechat_assistant_todos WHERE id = ?`)
    .get(id) as TodoRow | undefined;
  return row ? mapTodo(row) : null;
}

export function updateTodoFollowup(
  id: string,
  patch: {
    text?: string;
    summary?: string | null;
    nextStep?: string | null;
    followupType?: TodoFollowupType | null;
    dueAt?: number | null;
    remindAt?: number | null;
    involvedWxids?: string[];
  },
): WeChatTodo | null {
  const current = getDb()
    .prepare(`SELECT * FROM wechat_assistant_todos WHERE id = ?`)
    .get(id) as TodoRow | undefined;
  if (!current) return null;

  getDb().prepare(`
    UPDATE wechat_assistant_todos
       SET text = ?,
           summary = ?,
           next_step = ?,
           followup_type = ?,
           due_at = ?,
           remind_at = ?,
           source_wxid = ?,
           involved_wxids_json = ?
     WHERE id = ?
  `).run(
    patch.text ?? current.text,
    patch.summary === undefined ? current.summary ?? null : patch.summary,
    patch.nextStep === undefined ? current.next_step ?? null : patch.nextStep,
    patch.followupType === undefined ? current.followup_type ?? null : patch.followupType,
    patch.dueAt === undefined ? current.due_at : patch.dueAt,
    patch.remindAt === undefined ? current.remind_at : patch.remindAt,
    patch.involvedWxids === undefined
      ? current.source_wxid
      : (normalizeInvolvedWxids(patch.involvedWxids, null)[0] ?? null),
    patch.involvedWxids === undefined
      ? current.involved_wxids_json ?? null
      : JSON.stringify(normalizeInvolvedWxids(patch.involvedWxids, null)),
    id,
  );

  const row = getDb()
    .prepare(`SELECT * FROM wechat_assistant_todos WHERE id = ?`)
    .get(id) as TodoRow;
  return mapTodo(row);
}

export function deleteTodo(id: string): boolean {
  const info = getDb().prepare(`DELETE FROM wechat_assistant_todos WHERE id = ?`).run(id);
  return info.changes > 0;
}

function inferFollowupType(source: 'self' | 'other'): TodoFollowupType {
  return source === 'self' ? 'commitment' : 'reply';
}

function summarizeTodoSuggestion(input: WeChatTodoSuggestionInput): string | null {
  if (input.sourceText) return input.sourceText;
  if (input.sourceDisplay) return `来自「${input.sourceDisplay}」的微信消息`;
  return null;
}

function normalizeTodoSuggestion(input: WeChatTodoSuggestionInput): WeChatTodoSuggestionInput {
  return {
    ...input,
    text: safeSanitizedWechatText(input.text, '微信待跟进事项'),
    sourceText: cleanNullableText(input.sourceText),
    sourceDisplay: input.sourceDisplay || input.sourceWxid
      ? displayWechatName(input.sourceDisplay, input.sourceWxid, {
          groupFallback: '微信群聊',
          contactFallback: '微信联系人',
        })
      : null,
    sourceSenderDisplay: input.sourceSenderDisplay
      ? displayWechatName(input.sourceSenderDisplay, null, { contactFallback: '群成员' })
      : null,
    byWhenText: cleanNullableText(input.byWhenText),
  };
}

function cleanNullableText(value: string | null | undefined): string | null {
  const cleaned = sanitizeWechatText(value ?? '');
  return cleaned || null;
}

function normalizeInvolvedWxids(values: string[], fallback: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...values, fallback]) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
