import type { TodoStatus, WeChatAssistantRun, WeChatEvent, WeChatTodo } from './ai-types';
import {
  displayWechatName,
  safeSanitizedWechatText,
  sanitizeWechatText,
} from './wechat-text';

export interface RunRow {
  id: string;
  snapshot_hash: string;
  provider_id: string | null;
  model: string | null;
  started_at: number;
  finished_at: number | null;
  status: 'running' | 'done' | 'failed';
  message: string | null;
  events_count: number;
  todos_count: number;
  tokens_in: number | null;
  tokens_out: number | null;
  messages_scanned: number;
}

export interface EventRow {
  id: string;
  run_id: string;
  title: string;
  urgency: 'urgent' | 'important' | 'attention';
  contact_wxid: string;
  contact_display: string;
  is_group: number;
  evidence_msg_ids_json: string;
  evidence_texts_json: string;
  suggested_action: string;
  last_at: number;
  created_at: number;
}

export interface TodoRow {
  id: string;
  run_id: string | null;
  text: string;
  source: 'self' | 'other' | 'manual';
  source_msg_id: number | null;
  source_text: string | null;
  source_display: string | null;
  source_sender_display?: string | null;
  source_wxid: string | null;
  involved_wxids_json?: string | null;
  by_when_text: string | null;
  summary?: string | null;
  next_step?: string | null;
  followup_type?: 'reply' | 'commitment' | 'event' | 'health' | 'other' | null;
  due_at: number | null;
  remind_at: number | null;
  confidence: 'high' | 'medium' | null;
  status: TodoStatus;
  created_at: number;
  confirmed_at: number | null;
  done_at: number | null;
}

export function mapRun(row: RunRow): WeChatAssistantRun {
  return {
    id: row.id,
    snapshotHash: row.snapshot_hash,
    providerId: row.provider_id,
    model: row.model,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    message: row.message,
    eventsCount: row.events_count,
    todosCount: row.todos_count,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    messagesScanned: row.messages_scanned,
  };
}

export function mapEvent(row: EventRow): WeChatEvent {
  return {
    id: row.id,
    runId: row.run_id,
    title: row.title,
    urgency: row.urgency,
    contactWxid: row.contact_wxid,
    contactDisplay: row.contact_display,
    isGroup: row.is_group === 1,
    evidenceMsgIds: JSON.parse(row.evidence_msg_ids_json) as number[],
    evidenceTexts: JSON.parse(row.evidence_texts_json) as string[],
    suggestedAction: row.suggested_action,
    lastAt: row.last_at,
    createdAt: row.created_at,
  };
}

export function mapTodo(row: TodoRow): WeChatTodo {
  const sourceDisplay = todoSourceDisplay(row);
  return {
    id: row.id,
    runId: row.run_id,
    text: todoText(row, row.text, '微信待跟进事项'),
    source: row.source,
    sourceMsgId: row.source_msg_id,
    sourceText: todoOptionalText(row, row.source_text),
    sourceDisplay,
    sourceSenderDisplay: todoSenderDisplay(row),
    sourceWxid: row.source_wxid,
    involvedWxids: parseInvolvedWxids(row.involved_wxids_json, row.source_wxid),
    byWhenText: todoOptionalText(row, row.by_when_text),
    summary: todoSummary(row, sourceDisplay),
    nextStep: todoOptionalText(row, row.next_step),
    followupType: row.followup_type ?? null,
    dueAt: row.due_at,
    remindAt: row.remind_at,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    doneAt: row.done_at,
  };
}

function todoText(row: TodoRow, value: string, fallback: string): string {
  if (row.source === 'manual') return value;
  return safeSanitizedWechatText(value, fallback);
}

function todoOptionalText(row: TodoRow, value: string | null | undefined): string | null {
  if (row.source === 'manual') return value ?? null;
  const cleaned = sanitizeWechatText(value ?? '');
  return cleaned || null;
}

function todoSourceDisplay(row: TodoRow): string | null {
  if (row.source === 'manual') return row.source_display ?? null;
  if (!row.source_display && !row.source_wxid) return null;
  return displayWechatName(row.source_display, row.source_wxid, {
    groupFallback: '微信群聊',
    contactFallback: '微信联系人',
  });
}

function todoSenderDisplay(row: TodoRow): string | null {
  if (row.source === 'manual') return row.source_sender_display ?? null;
  if (!row.source_sender_display) return null;
  return displayWechatName(row.source_sender_display, null, { contactFallback: '群成员' });
}

function todoSummary(row: TodoRow, sourceDisplay: string | null): string | null {
  if (row.source === 'manual') return row.summary ?? null;
  const cleaned = sanitizeWechatText(row.summary ?? '');
  if (!cleaned || /^来自「\s*」的微信消息$/.test(cleaned)) {
    return sourceDisplay ? `来自「${sourceDisplay}」的微信消息` : null;
  }
  return cleaned;
}

function parseInvolvedWxids(raw: string | null | undefined, fallback: string | null): string[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return uniqueStrings(parsed);
      }
    } catch {
      // Fall through to the legacy source_wxid fallback.
    }
  }
  return fallback ? [fallback] : [];
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
