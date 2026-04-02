/**
 * Auto-summarizer — generate document summaries + key points via Claude Haiku
 * Stores summary embedding for summary-level retrieval (P0)
 */
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { genId } from '@/lib/stores/helpers';
import { getEmbeddings, vectorToBuffer } from './embedder';
import type { DocumentSummary } from './types';
import { callKnowledgeModel, callKnowledgeObjectModel, getKnowledgeDefaultModel } from './llm';
import { loadFullItemContent } from './pipeline-support';

const MAX_SUMMARY_SOURCE_CHARS = 9000;
const SUMMARY_SECTION_COUNT = 3;

const SUMMARY_PROMPT = `你是文档摘要专家。为以下文档生成：
1. 一段100-200字的摘要（summary）
2. 3-5个关键要点（key_points），每个要点一句话

只返回JSON：{"summary":"...","key_points":["要点1","要点2",...]}

文档内容：
`;

const summaryResponseSchema = z.object({
  summary: z.string().trim().min(1),
  key_points: z.array(z.string().trim().min(1)).max(5).default([]),
});

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

async function callSummaryText(content: string): Promise<string> {
  return callKnowledgeModel({
    model: getKnowledgeDefaultModel(),
    maxTokens: 16000,
    timeoutMs: 30000,
    prompt: SUMMARY_PROMPT + content,
  });
}

async function callSummaryStructured(content: string): Promise<z.infer<typeof summaryResponseSchema>> {
  return callKnowledgeObjectModel({
    model: getKnowledgeDefaultModel(),
    maxTokens: 16000,
    timeoutMs: 30000,
    schema: summaryResponseSchema,
    prompt: [
      '请阅读文档并输出摘要对象。',
      '要求：',
      '- summary: 100-200 字中文摘要',
      '- key_points: 3-5 条关键要点，每条一句话',
      '- 不要遗漏文档主题和关键结论',
      '',
      '文档内容：',
      content,
    ].join('\n'),
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

  if (!item) {
    console.warn(`[kb] summarizeItem: item ${itemId} not found in DB`);
    return null;
  }

  const fullContent = loadFullItemContent(itemId, item.content);

  if (!fullContent || fullContent.length < 30) {
    console.warn(`[kb] summarizeItem: content too short (${fullContent?.length ?? 0} chars) for item ${itemId}, skipping summary`);
    return null;
  }

  const summarySource = buildSummarySource(item.title, fullContent);
  let summary = '';
  let keyPoints: string[] = [];

  try {
    const structured = await callSummaryStructured(summarySource);
    summary = structured.summary.trim();
    keyPoints = structured.key_points
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);
  } catch (structuredError) {
    const structuredMsg = structuredError instanceof Error ? structuredError.message : String(structuredError);
    console.warn('[kb] Structured summary failed, falling back to text mode:', structuredMsg);
    try {
      const text = await callSummaryText(summarySource);
      const parsed = parseResponse(text);
      summary = parsed.summary.trim();
      keyPoints = parsed.keyPoints;
      if (!summary) {
        console.warn('[kb] Text fallback returned empty summary for item', itemId);
      }
    } catch (fallbackError) {
      const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      console.error(`[kb] Both structured and text summary failed for item ${itemId}:`, fallbackMsg);
      throw new Error(`摘要生成失败: structured=${structuredMsg}; fallback=${fallbackMsg}`);
    }
  }

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

export function clearSummaryArtifacts(itemId: string): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare(
      'UPDATE kb_items SET summary=?, key_points=?, summary_embedding=? WHERE id=?',
    ).run('', '[]', null, itemId);
    db.prepare(
      "DELETE FROM kb_summaries WHERE scope = 'item' AND scope_id = ?",
    ).run(itemId);
  });
  transaction();
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
export async function summarizeAndEmbedStrict(itemId: string): Promise<DocumentSummary | null> {
  const result = await summarizeItem(itemId);
  if (result) {
    await embedSummary(itemId);
  }
  return result;
}

export async function summarizeAndEmbed(itemId: string): Promise<DocumentSummary | null> {
  try {
    return await summarizeAndEmbedStrict(itemId);
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
