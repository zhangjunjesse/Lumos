/**
 * Auto-summarizer — generate document summaries + key points via Claude Haiku
 * Stores summary embedding for summary-level retrieval (P0)
 */
import { getDb, getSetting } from '@/lib/db';
import { genId } from '@/lib/stores/helpers';
import { getEmbeddings, vectorToBuffer } from './embedder';
import type { DocumentSummary } from './types';

const SUMMARY_PROMPT = `你是文档摘要专家。为以下文档生成：
1. 一段100-200字的摘要（summary）
2. 3-5个关键要点（key_points），每个要点一句话

只返回JSON：{"summary":"...","key_points":["要点1","要点2",...]}

文档内容：
`;

async function callHaiku(content: string): Promise<string> {
  const apiKey = getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('未配置 API Key');

  const baseUrl = getSetting('anthropic_base_url') || 'https://api.anthropic.com';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-20250514',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: SUMMARY_PROMPT + content.slice(0, 6000),
      }],
    }),
  });
  clearTimeout(timer);

  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.content?.[0]?.text || '';
}

function parseResponse(text: string): { summary: string; keyPoints: string[] } {
  const objMatch = text.match(/\{[\s\S]*\}/);
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

  const text = await callHaiku(`标题：${item.title}\n\n${fullContent}`);
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
    'SELECT summary FROM kb_items WHERE id=? AND summary != \'\''
  ).get(itemId) as { summary: string } | undefined;

  if (!row?.summary) return false;

  try {
    const [vec] = await getEmbeddings([row.summary]);
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
