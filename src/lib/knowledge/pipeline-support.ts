import { getDb } from '@/lib/db';

const KB_ITEM_PREVIEW_MAX_CHARS = 2000;
const PROCESSING_ERROR_SEPARATOR = '；';

function normalizeKnowledgeText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildStoredPreviewContent(content: string): string {
  const normalized = normalizeKnowledgeText(content);
  if (!normalized) {
    return '';
  }

  return normalized.slice(0, KB_ITEM_PREVIEW_MAX_CHARS);
}

export function formatKnowledgeStageError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  return fallback;
}

function splitProcessingErrors(raw: string): string[] {
  return raw
    .split(PROCESSING_ERROR_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function appendProcessingMessage(
  current: string,
  stageLabel: string,
  message?: string | null,
): string {
  const normalizedMessage = message?.trim();
  if (!normalizedMessage) {
    return current.trim();
  }

  const entry = stageLabel.trim()
    ? `${stageLabel.trim()}: ${normalizedMessage}`
    : normalizedMessage;
  const entries = splitProcessingErrors(current);
  if (!entries.includes(entry)) {
    entries.push(entry);
  }
  return entries.join(PROCESSING_ERROR_SEPARATOR);
}

export function appendProcessingError(
  current: string,
  stageLabel: string,
  error: unknown,
  fallback: string,
): string {
  return appendProcessingMessage(
    current,
    stageLabel,
    formatKnowledgeStageError(error, fallback),
  );
}

export function loadFullItemContent(itemId: string, fallbackContent = ''): string {
  const db = getDb();
  const chunks = db.prepare(
    'SELECT content FROM kb_chunks WHERE item_id=? ORDER BY chunk_index',
  ).all(itemId) as { content: string }[];

  const chunkContents = chunks
    .map((chunk) => (chunk.content || '').trim())
    .filter((content) => content.length > 0);

  const reconstructed = joinChunksDedupOverlap(chunkContents).trim();
  if (reconstructed) {
    return reconstructed;
  }

  return fallbackContent.trim();
}

const CHUNK_OVERLAP_PROBE_LIMIT = 200;

/**
 * Reconstruct a continuous text from RAG chunks, removing the chunker's
 * sliding overlap so the model does not see repeated phrases. lumos chunker
 * carries 50-120 chars of suffix into the next chunk; we detect the longest
 * matching suffix/prefix between adjacent chunks (capped at 200 chars) and
 * splice only those duplicated chars out. The "\n\n" separators inside chunks
 * are part of the original text (paragraph breaks) and must be preserved.
 * When no overlap is detected, fall back to a paragraph join.
 */
export function joinChunksDedupOverlap(chunks: readonly string[]): string {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0];

  const parts: string[] = [chunks[0]];
  for (let i = 1; i < chunks.length; i += 1) {
    const prev = chunks[i - 1];
    const cur = chunks[i];
    const overlap = findLongestSuffixPrefixOverlap(prev, cur, CHUNK_OVERLAP_PROBE_LIMIT);
    if (overlap > 0) {
      parts.push(cur.slice(overlap));
    } else {
      parts.push(`\n\n${cur}`);
    }
  }
  return parts.join('');
}

function findLongestSuffixPrefixOverlap(prev: string, cur: string, limit: number): number {
  const max = Math.min(limit, prev.length, cur.length);
  for (let len = max; len > 0; len -= 1) {
    if (prev.endsWith(cur.slice(0, len))) {
      return len;
    }
  }
  return 0;
}
