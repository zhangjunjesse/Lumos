/**
 * Auto-summarizer — generate document summaries + key points via Claude Haiku
 * Stores summary embedding for summary-level retrieval (P0)
 */
import { getDb } from '@/lib/db';
import { genId } from '@/lib/stores/helpers';
import { getEmbeddings, vectorToBuffer } from './embedder';
import type { DocumentSummary } from './types';
import { callKnowledgeModel } from './llm';
import { BUILTIN_CLAUDE_MODEL_IDS } from '@/lib/model-metadata';

const MAX_SUMMARY_SOURCE_CHARS = 9000;
const SUMMARY_SECTION_COUNT = 3;

const SUMMARY_PROMPT = `你是文档摘要专家。为以下文档生成：
1. 一段100-200字的摘要（summary）
2. 3-5个关键要点（key_points），每个要点一句话

只返回JSON：{"summary":"...","key_points":["要点1","要点2",...]}

文档内容：
`;

function sanitizeText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pickWindow(content: string, start: number, size: number): string {
  const clampedStart = Math.max(0, Math.min(content.length, start));
  const end = Math.min(content.length, clampedStart + size);
  return content.slice(clampedStart, end).trim();
}

function buildSummarySource(title: string, content: string): string {
  const normalized = sanitizeText(content);
  if (!normalized) return `标题：${title}`;
  if (normalized.length <= MAX_SUMMARY_SOURCE_CHARS) {
    return `标题：${title}\n\n${normalized}`;
  }

  const sectionSize = Math.floor(MAX_SUMMARY_SOURCE_CHARS / SUMMARY_SECTION_COUNT);
  const head = pickWindow(normalized, 0, sectionSize);
  const middleStart = Math.max(0, Math.floor(normalized.length / 2 - sectionSize / 2));
  const middle = pickWindow(normalized, middleStart, sectionSize);
  const tail = pickWindow(normalized, normalized.length - sectionSize, sectionSize);
  const sections = [head, middle, tail].filter(Boolean);

  return [
    `标题：${title}`,
    '',
    '[文档开头]',
    sections[0] || '',
    '',
    '[文档中段]',
    sections[1] || '',
    '',
    '[文档结尾]',
    sections[2] || '',
  ].join('\n');
}

async function callHaiku(content: string): Promise<string> {
  return callKnowledgeModel({
    model: BUILTIN_CLAUDE_MODEL_IDS.haiku,
    maxTokens: 600,
    timeoutMs: 15000,
    prompt: SUMMARY_PROMPT + content,
  });
}

function parseResponse(text: string): { summary: string; keyPoints: string[] } {
  const stripped = text
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();
  const objMatch = stripped.match(/\{[\s\S]*\}/);
  if (!objMatch) return { summary: text.slice(0, 200), keyPoints: [] };

  try {
    const obj = JSON.parse(objMatch[0]);
    const summary = typeof obj.summary === 'string' ? obj.summary : '';
    const keyPoints = Array.isArray(obj.key_points)
      ? obj.key_points.filter((p: unknown) => typeof p === 'string')
      : [];
    return { summary, keyPoints };
  } catch {
    return { summary: text.slice(0, 200), keyPoints: [] };
  }
}

/** Generate summary for a document and store in DB */
export async function summarizeItem(itemId: string): Promise<DocumentSummary | null> {
  const db = getDb();
  const item = db.prepare(
    'SELECT id, title, content FROM kb_items WHERE id=?'
  ).get(itemId) as { id: string; title: string; content: string } | undefined;

  if (!item) return null;

  // Get full content from chunks if item.content is empty
  let fullContent = item.content;
  if (!fullContent || fullContent.length < 50) {
    const chunks = db.prepare(
      'SELECT content FROM kb_chunks WHERE item_id=? ORDER BY chunk_index'
    ).all(itemId) as { content: string }[];
    fullContent = chunks.map(c => c.content).join('\n\n');
  }

  if (!fullContent || fullContent.length < 30) return null;

  const text = await callHaiku(buildSummarySource(item.title, fullContent));
  const { summary, keyPoints } = parseResponse(text);
  if (!summary) return null;

  const now = new Date().toISOString();

  // Store in kb_items columns
  db.prepare(
    'UPDATE kb_items SET summary=?, key_points=? WHERE id=?'
  ).run(summary, JSON.stringify(keyPoints), itemId);

  // Also store in kb_summaries table
  const id = genId();
  db.prepare(`
    INSERT OR REPLACE INTO kb_summaries (id, scope, scope_id, summary, key_points, model, updated_at)
    VALUES (?, 'item', ?, ?, ?, 'haiku', ?)
  `).run(id, itemId, summary, JSON.stringify(keyPoints), now);

  return { itemId, summary, keyPoints, generatedAt: now };
}

/** Generate and store summary embedding for summary-level retrieval */
export async function embedSummary(itemId: string): Promise<boolean> {
  const db = getDb();
  const row = db.prepare(
    'SELECT summary, key_points FROM kb_items WHERE id=? AND summary != \'\''
  ).get(itemId) as { summary: string; key_points: string } | undefined;

  if (!row?.summary) return false;

  try {
    let keyPoints: string[] = [];
    try {
      const parsed = JSON.parse(row.key_points || '[]');
      if (Array.isArray(parsed)) {
        keyPoints = parsed.filter((entry) => typeof entry === 'string').slice(0, 5);
      }
    } catch {
      keyPoints = [];
    }
    const semanticText = [row.summary, ...keyPoints].filter(Boolean).join('\n');
    const [vec] = await getEmbeddings([semanticText]);
    if (vec) {
      db.prepare('UPDATE kb_items SET summary_embedding=? WHERE id=?')
        .run(vectorToBuffer(vec), itemId);
      return true;
    }
  } catch (err) {
    console.error('[kb] Summary embedding failed:', (err as Error).message);
  }
  return false;
}

/** Full pipeline: summarize + embed summary (call after import) */
export async function summarizeAndEmbed(itemId: string): Promise<DocumentSummary | null> {
  try {
    const result = await summarizeItem(itemId);
    if (result) {
      await embedSummary(itemId);
    }
    return result;
  } catch (err) {
    console.error('[kb] Summarize pipeline failed:', (err as Error).message);
    return null;
  }
}

/** Get existing summary for an item */
export function getSummary(itemId: string): DocumentSummary | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT summary, key_points FROM kb_items WHERE id=? AND summary != \'\''
  ).get(itemId) as { summary: string; key_points: string } | undefined;

  if (!row) return null;

  let keyPoints: string[] = [];
  try { keyPoints = JSON.parse(row.key_points); } catch { /* empty */ }

  return {
    itemId,
    summary: row.summary,
    keyPoints,
    generatedAt: '',
  };
}
