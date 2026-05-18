import path from 'path';
import { getDb, getSetting, setSetting } from '@/lib/db';
import { parseMessageContent, type ChatSession, type MessageContentBlock } from '@/types';
import { isMainAgentSession } from '@/lib/chat/session-entry';
import { isWeChatAssistantChatSession } from '@/lib/chat/wechat-assistant-session';
import { isWorkflowChatSession } from '@/lib/chat/workflow-session';
import {
  extractAndReconcileMemoryV2,
  type MemoryV2ExtractionContext,
  type MemoryV2MessageInput,
} from './extraction';
import type { MemoryV2Entry } from './types';

const LAST_ROWID_KEY = 'memory_v2_auto_summary_last_message_rowid';
const FIRST_SCAN_HOURS = 24;
const MAX_MESSAGES_PER_SESSION = 60;

interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  _rowid: number;
  session_title: string;
  mode: string;
  working_directory: string;
  sdk_cwd: string;
  project_name: string;
}

export interface MemoryV2AutoSummaryResult {
  scanned: number;
  considered: number;
  created: MemoryV2Entry[];
  updated: MemoryV2Entry[];
  archivedIds: string[];
  maxRowId: number;
  llmAvailable: boolean;
  reason: string;
}

function compact(value: string, max = 1600): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function cleanMessageText(content: string): string {
  const withoutFilePrefix = content.replace(/^<!--files:[\s\S]*?-->/, '').trim();
  let blocks: MessageContentBlock[];
  try {
    blocks = parseMessageContent(withoutFilePrefix);
  } catch {
    return compact(withoutFilePrefix);
  }
  return compact(
    blocks
      .map((block) => {
        if (block.type === 'text') return block.text;
        if (block.type === 'code') return block.code;
        return '';
      })
      .filter(Boolean)
      .join('\n'),
  );
}

function ownerModuleFor(session: ChatSession): string {
  if (isWorkflowChatSession(session)) return 'workflow';
  if (isWeChatAssistantChatSession(session)) return 'wechat-assistant';
  if (isMainAgentSession(session)) return 'main-agent';
  if (session.sdk_cwd || session.working_directory) return 'project-chat';
  return 'chat';
}

function getLastRowId(): number {
  const raw = Number(getSetting(LAST_ROWID_KEY) || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function listNewMessages(lastRowId: number, limit: number): MessageRow[] {
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const firstScanCutoff = new Date(Date.now() - FIRST_SCAN_HOURS * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .split('.')[0];
  const firstScanClause = lastRowId > 0 ? '' : 'AND m.created_at >= ?';
  const args: unknown[] = lastRowId > 0
    ? [lastRowId, safeLimit]
    : [lastRowId, firstScanCutoff, safeLimit];
  return getDb().prepare(
    `SELECT
       m.id,
       m.session_id,
       m.role,
       m.content,
       m.created_at,
       m.rowid AS _rowid,
       COALESCE(s.title, '') AS session_title,
       COALESCE(s.mode, '') AS mode,
       COALESCE(s.working_directory, '') AS working_directory,
       COALESCE(s.sdk_cwd, '') AS sdk_cwd,
       COALESCE(s.project_name, '') AS project_name
     FROM messages m
     LEFT JOIN chat_sessions s ON s.id = m.session_id
     WHERE m.rowid > ?
       AND m.role IN ('user', 'assistant')
       ${firstScanClause}
     ORDER BY m.rowid ASC
     LIMIT ?`,
  ).all(...args) as MessageRow[];
}

function rowToSession(row: MessageRow): ChatSession {
  return {
    id: row.session_id,
    title: row.session_title,
    created_at: '',
    updated_at: '',
    model: '',
    requested_model: '',
    resolved_model: '',
    system_prompt: '',
    working_directory: row.working_directory,
    sdk_session_id: '',
    project_name: row.project_name || path.basename(row.sdk_cwd || row.working_directory || ''),
    status: 'active',
    mode: (row.mode || 'code') as ChatSession['mode'],
    provider_name: '',
    provider_id: '',
    browser_context_id: '',
    sdk_cwd: row.sdk_cwd,
    runtime_status: '',
    runtime_updated_at: '',
    runtime_error: '',
    folder: '',
    knowledge_enabled: 0,
    knowledge_tag_ids: '[]',
    knowledge_overrides: '{}',
  };
}

interface SessionBatch {
  context: MemoryV2ExtractionContext;
  messages: MemoryV2MessageInput[];
}

function groupBySession(rows: MessageRow[]): SessionBatch[] {
  const order: string[] = [];
  const bySession = new Map<string, MessageRow[]>();
  for (const row of rows) {
    if (!bySession.has(row.session_id)) {
      bySession.set(row.session_id, []);
      order.push(row.session_id);
    }
    bySession.get(row.session_id)!.push(row);
  }
  return order.map((sessionId) => {
    const sessionRows = bySession.get(sessionId)!;
    const session = rowToSession(sessionRows[0]);
    return {
      context: {
        sessionId,
        projectPath: (session.sdk_cwd || session.working_directory || '').trim(),
        ownerModule: ownerModuleFor(session),
      },
      messages: sessionRows
        .slice(-MAX_MESSAGES_PER_SESSION)
        .map((row) => ({ role: row.role, text: cleanMessageText(row.content) }))
        .filter((message) => message.text.length > 0),
    };
  });
}

// 睡眠时把新对话交给 LLM 抽取 + 逐条 reconcile（Mem0 式）。
// 没有可用文本模型时一条都不记，绝不回退正则。
export async function summarizeNewMemoryV2FromMessages(params: {
  limit?: number;
} = {}): Promise<MemoryV2AutoSummaryResult> {
  const lastRowId = getLastRowId();
  const rows = listNewMessages(lastRowId, params.limit ?? 200);
  const maxRowId = rows.reduce((max, row) => Math.max(max, row._rowid), lastRowId);

  const result: MemoryV2AutoSummaryResult = {
    scanned: rows.length,
    considered: 0,
    created: [],
    updated: [],
    archivedIds: [],
    maxRowId,
    llmAvailable: true,
    reason: rows.length === 0 ? 'no_messages' : '',
  };

  for (const batch of groupBySession(rows)) {
    if (batch.messages.length === 0) continue;
    const outcome = await extractAndReconcileMemoryV2(batch.messages, batch.context);
    if (!outcome.available) {
      // 模型不可用：不记、不报错、不推进游标，下次睡眠重试。
      result.llmAvailable = false;
      result.reason = outcome.reason;
      return result;
    }
    result.considered += outcome.added.length + outcome.updated.length + outcome.noop + outcome.skipped;
    result.created.push(...outcome.added);
    result.updated.push(...outcome.updated);
    result.archivedIds.push(...outcome.archivedIds);
  }

  if (maxRowId > lastRowId) {
    setSetting(LAST_ROWID_KEY, String(maxRowId));
  }
  if (!result.reason) result.reason = 'ok';
  return result;
}
