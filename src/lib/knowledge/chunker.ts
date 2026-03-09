/**
 * Text chunker — paragraph-aware splitting with overlap
 * Ported from demo/local-server/services/knowledge/chunker.js
 */

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 50;
const LARGE_DOC_CHUNK_SIZE = 720;
const LARGE_DOC_OVERLAP = 90;
const HUGE_DOC_CHUNK_SIZE = 920;
const HUGE_DOC_OVERLAP = 120;
const LARGE_DOC_THRESHOLD = 12_000;
const HUGE_DOC_THRESHOLD = 50_000;

function resolveChunkConfig(
  textLength: number,
  chunkSize?: number,
  overlap?: number,
): { size: number; overlap: number } {
  if (Number.isFinite(chunkSize) && chunkSize! > 0) {
    const size = Math.max(120, Math.floor(chunkSize!));
    const safeOverlap = Number.isFinite(overlap) && overlap! >= 0
      ? Math.min(size - 1, Math.floor(overlap!))
      : Math.min(size - 1, DEFAULT_OVERLAP);
    return { size, overlap: safeOverlap };
  }

  if (textLength >= HUGE_DOC_THRESHOLD) {
    return { size: HUGE_DOC_CHUNK_SIZE, overlap: HUGE_DOC_OVERLAP };
  }
  if (textLength >= LARGE_DOC_THRESHOLD) {
    return { size: LARGE_DOC_CHUNK_SIZE, overlap: LARGE_DOC_OVERLAP };
  }
  return { size: DEFAULT_CHUNK_SIZE, overlap: DEFAULT_OVERLAP };
}

/** Split text at paragraph boundaries with overlap */
export function splitText(
  text: string,
  chunkSize?: number,
  overlap?: number,
): string[] {
  const { size, overlap: resolvedOverlap } = resolveChunkConfig(text?.length || 0, chunkSize, overlap);

  if (!text || text.length <= size) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length > size && current.length > 0) {
      chunks.push(current.trim());
      const tail = current.slice(-resolvedOverlap);
      current = tail + '\n\n' + trimmed;
    } else {
      current += (current ? '\n\n' : '') + trimmed;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  // Force-chunk if single large paragraph
  if (chunks.length === 1 && chunks[0].length > size * 1.5) {
    return forceChunk(chunks[0], size, resolvedOverlap);
  }
  return chunks;
}

function forceChunk(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return chunks;
}
