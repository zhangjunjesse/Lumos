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

  const chunkContent = chunks
    .map((chunk) => chunk.content || '')
    .join('\n\n')
    .trim();

  if (chunkContent) {
    return chunkContent;
  }

  return fallbackContent.trim();
}
