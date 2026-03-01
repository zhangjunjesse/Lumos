/**
 * Text chunker — paragraph-aware splitting with overlap
 * Ported from demo/local-server/services/knowledge/chunker.js
 */

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 50;

/** Split text at paragraph boundaries with overlap */
export function splitText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): string[] {
  if (!text || text.length <= chunkSize) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      const tail = current.slice(-overlap);
      current = tail + '\n\n' + trimmed;
    } else {
      current += (current ? '\n\n' : '') + trimmed;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  // Force-chunk if single large paragraph
  if (chunks.length === 1 && chunks[0].length > chunkSize * 1.5) {
    return forceChunk(chunks[0], chunkSize, overlap);
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
