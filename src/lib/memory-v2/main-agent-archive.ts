import { getDb } from '@/lib/db/connection';
import {
  createMemoryV2Entry,
  getMemoryV2EntryBySource,
  setMemoryV2Embedding,
  updateMemoryV2Entry,
} from './store';
import { embedMemoryEntryText, memoryEmbedText } from './vector';
import { isMainAgentSession } from '@/lib/chat/session-entry';
import { currentMainAgentDayKey, sessionDayKey } from '@/lib/chat/main-agent-session';

// 主 Agent 单日会话 → 向量片段。
// - source_type='daily_chat'、source_id=`${day}#${idx}`：内容不变即重复幂等。
// - kind='reflection'、scope=('main_agent','main')：跟 memory-v2 现有 scope 体系对齐，
//   召回路径在 listMemoryV2ForScopes 已默认带 main_agent。
// - 失败局部抓掉：embed 失败不影响其它 chunk；DB 写失败 console.warn 跳过。

const CHUNK_TARGET_CHARS = 800;
const SINGLE_MESSAGE_CAP = 600;
const MAX_CHUNKS_PER_DAY = 50;

interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface SessionRow {
  id: string;
  title: string;
  system_prompt: string;
  status: string;
  created_at: string;
}

interface Chunk {
  index: number;
  body: string;
  sessionIds: string[];
  firstMessageId: string;
  messageCount: number;
}

export interface MainAgentArchiveResult {
  day: string;
  sessionCount: number;
  messageCount: number;
  chunks: number;
  embedded: number;
  skipped: boolean;
}

function cleanMessageText(content: string): string {
  const withoutFiles = content.replace(/^<!--files:[\s\S]*?-->/, '').trim();
  try {
    const blocks = JSON.parse(withoutFiles);
    if (Array.isArray(blocks)) {
      return blocks
        .map((b) => (b?.type === 'text' ? b.text : b?.type === 'code' ? b.code : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
    }
  } catch {
    // not JSON, treat as plain text
  }
  return withoutFiles;
}

function clip(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function listMainAgentSessionsForDay(day: string): SessionRow[] {
  const rows = getDb()
    .prepare('SELECT id, title, system_prompt, status, created_at FROM chat_sessions ORDER BY created_at ASC')
    .all() as SessionRow[];
  return rows.filter((session) =>
    isMainAgentSession({ system_prompt: session.system_prompt })
    && sessionDayKey(session.created_at) === day,
  );
}

function listMessagesForSession(sessionId: string): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT id, session_id, role, content, created_at
       FROM messages
       WHERE session_id = ? AND role IN ('user','assistant')
       ORDER BY rowid ASC`,
    )
    .all(sessionId) as MessageRow[];
}

function chunkMessages(sessions: SessionRow[]): Chunk[] {
  const chunks: Chunk[] = [];
  let buffer = '';
  let sessionIds = new Set<string>();
  let firstMessageId = '';
  let messageCount = 0;

  const flush = () => {
    const body = buffer.trim();
    if (!body) return;
    chunks.push({
      index: chunks.length,
      body,
      sessionIds: Array.from(sessionIds),
      firstMessageId,
      messageCount,
    });
    buffer = '';
    sessionIds = new Set<string>();
    firstMessageId = '';
    messageCount = 0;
  };

  for (const session of sessions) {
    if (chunks.length >= MAX_CHUNKS_PER_DAY) break;
    const messages = listMessagesForSession(session.id);
    for (const msg of messages) {
      const text = clip(cleanMessageText(msg.content), SINGLE_MESSAGE_CAP);
      if (!text) continue;
      const line = `${msg.role === 'user' ? '用户' : '助手'}：${text}`;
      const projected = buffer ? `${buffer}\n${line}` : line;
      if (buffer.length > 0 && projected.length > CHUNK_TARGET_CHARS) {
        flush();
        if (chunks.length >= MAX_CHUNKS_PER_DAY) return chunks;
        buffer = line;
        sessionIds = new Set([session.id]);
        firstMessageId = msg.id;
        messageCount = 1;
      } else {
        buffer = projected;
        sessionIds.add(session.id);
        if (!firstMessageId) firstMessageId = msg.id;
        messageCount += 1;
      }
    }
  }

  flush();
  return chunks;
}

export async function archiveMainAgentChatForDay(day: string): Promise<MainAgentArchiveResult> {
  const sessions = listMainAgentSessionsForDay(day);
  if (sessions.length === 0) {
    return { day, sessionCount: 0, messageCount: 0, chunks: 0, embedded: 0, skipped: true };
  }
  const chunks = chunkMessages(sessions);
  const totalMessages = chunks.reduce((sum, c) => sum + c.messageCount, 0);
  if (chunks.length === 0) {
    return { day, sessionCount: sessions.length, messageCount: 0, chunks: 0, embedded: 0, skipped: true };
  }

  let embedded = 0;
  for (const chunk of chunks) {
    const title = `主 Agent ${day} 第${chunk.index + 1}段`;
    const sourceId = `${day}#${String(chunk.index).padStart(3, '0')}`;
    const existing = getMemoryV2EntryBySource('daily_chat', sourceId);

    let entryId: string | undefined;
    try {
      if (existing) {
        const updated = updateMemoryV2Entry(existing.id, {
          title,
          body: chunk.body,
          status: 'active',
        });
        entryId = updated?.id;
      } else {
        const created = createMemoryV2Entry({
          kind: 'reflection',
          scopeType: 'main_agent',
          scopeKey: 'main',
          ownerModule: 'main_agent_archive',
          status: 'active',
          title,
          body: chunk.body,
          sourceType: 'daily_chat',
          sourceId,
          sessionId: chunk.sessionIds[0] || '',
          messageId: chunk.firstMessageId,
          confidence: 0.8,
          importance: 2,
          tags: ['main-agent', 'daily-chat', day],
        });
        entryId = created.id;
      }
    } catch (error) {
      console.warn('[main-agent-archive] write entry failed', sourceId, error);
      continue;
    }

    if (!entryId) continue;
    try {
      const buf = await embedMemoryEntryText(memoryEmbedText(title, chunk.body));
      if (buf && setMemoryV2Embedding(entryId, buf)) embedded += 1;
    } catch (error) {
      console.warn('[main-agent-archive] embed failed', sourceId, error);
    }
  }

  return {
    day,
    sessionCount: sessions.length,
    messageCount: totalMessages,
    chunks: chunks.length,
    embedded,
    skipped: false,
  };
}

// "上一个 main agent day"——sleep tick 归档刚结束的那一天用。
// currentMainAgentDayKey 已经把 sleep_time 偏移算进去，这里只做日期减一。
function previousMainAgentDay(now = new Date()): string {
  const todayKey = currentMainAgentDayKey(now);
  const [y, m, d] = todayKey.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const yyyy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(prev.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function archivePreviousMainAgentDay(): Promise<MainAgentArchiveResult> {
  return archiveMainAgentChatForDay(previousMainAgentDay());
}
