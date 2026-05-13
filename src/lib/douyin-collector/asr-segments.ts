import type { TranscriptSegment } from './transcript-fetcher';

const MAX_CHUNK_CHARS = 120;
const MIN_CHUNK_CHARS = 18;

/**
 * Cloud ASR currently returns a plain text blob without word-level or
 * sentence-level timestamps. Store/display it as readable timed chunks so
 * transcript panels and AI chapter prompts do not collapse everything under
 * 0:00. Timestamps are approximate and proportional to text length.
 */
export function buildApproximateAsrSegments(
  text: string,
  durationSeconds?: number | null,
  startOffsetSeconds = 0,
): TranscriptSegment[] {
  const chunks = splitAsrTextIntoChunks(text);
  if (chunks.length === 0) return [];

  const startOffset = normalizeSeconds(startOffsetSeconds) ?? 0;
  const duration = normalizeSeconds(durationSeconds);
  if (chunks.length === 1) {
    return [
      {
        startSec: roundTime(startOffset),
        endSec: roundTime(duration ? startOffset + duration : startOffset),
        text: chunks[0],
      },
    ];
  }

  if (!duration) {
    return [{ startSec: roundTime(startOffset), endSec: roundTime(startOffset), text: chunks.join('') }];
  }

  const weights = chunks.map((chunk) => Math.max(1, chunk.replace(/\s+/g, '').length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || chunks.length;
  const finalEnd = startOffset + duration;
  let consumedWeight = 0;
  let cursor = startOffset;

  return chunks.map((chunk, index) => {
    const start = index === 0 ? startOffset : cursor;
    let end: number;
    if (index === chunks.length - 1) {
      end = finalEnd;
    } else {
      consumedWeight += weights[index];
      end = startOffset + (duration * consumedWeight) / totalWeight;
      end = Math.max(start, Math.min(end, finalEnd));
    }
    cursor = end;
    return {
      startSec: roundTime(start),
      endSec: roundTime(end),
      text: chunk,
    };
  });
}

/**
 * Expand legacy one-blob ASR transcripts at read time. This lets existing
 * successful ASR records render better without forcing the user to pay for
 * another transcription.
 */
export function normalizeAsrSegmentsForDisplay(
  segments: TranscriptSegment[],
  fallbackDurationSeconds?: number | null,
): TranscriptSegment[] {
  if (segments.length !== 1) return segments;
  const only = segments[0];
  const text = only.text.trim();
  if (!text || text.length < MAX_CHUNK_CHARS) return segments;

  const start = normalizeSeconds(only.startSec) ?? 0;
  const storedDuration =
    normalizeSeconds(only.endSec) != null
      ? Math.max(0, (normalizeSeconds(only.endSec) ?? 0) - start)
      : null;
  const duration = storedDuration && storedDuration > 0 ? storedDuration : fallbackDurationSeconds;
  const expanded = buildApproximateAsrSegments(text, duration, start);
  return expanded.length > 1 ? expanded : segments;
}

export function splitAsrTextIntoChunks(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];

  const sentences: string[] = [];
  for (const paragraph of normalized.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    sentences.push(...splitParagraphIntoSentences(paragraph));
  }

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    const shouldMerge =
      current.length < MIN_CHUNK_CHARS ||
      sentence.length < MIN_CHUNK_CHARS ||
      current.length + sentence.length <= MAX_CHUNK_CHARS;
    if (shouldMerge) {
      current = joinChunks(current, sentence);
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitParagraphIntoSentences(paragraph: string): string[] {
  const sentences: string[] = [];
  let buffer = '';
  for (let i = 0; i < paragraph.length; i++) {
    const ch = paragraph[i];
    buffer += ch;
    if (!isSentenceBoundary(ch)) continue;

    while (i + 1 < paragraph.length && isTrailingQuote(paragraph[i + 1])) {
      i += 1;
      buffer += paragraph[i];
    }
    const sentence = buffer.trim();
    if (sentence) sentences.push(sentence);
    buffer = '';
  }
  const tail = buffer.trim();
  if (tail) sentences.push(tail);
  return sentences.length > 0 ? sentences : [paragraph.trim()].filter(Boolean);
}

function isSentenceBoundary(ch: string): boolean {
  return ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?' || ch === '；' || ch === ';';
}

function isTrailingQuote(ch: string): boolean {
  return ch === '"' || ch === "'" || ch === '”' || ch === '’' || ch === ')' || ch === '）' || ch === '】' || ch === '》';
}

function joinChunks(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)
    ? `${left} ${right}`
    : `${left}${right}`;
}

function normalizeSeconds(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function roundTime(value: number): number {
  return Math.round(value * 10) / 10;
}
