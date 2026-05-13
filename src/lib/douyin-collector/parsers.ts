/**
 * Shared parsers for the douyin-collector denormalized JSON columns.
 *
 * `tags` and `chapters` are stored as JSON strings in the `videos`
 * collection so the data store doesn't need to learn about array shapes.
 * UI / API code parses them lazily with these helpers — keeping a single
 * canonical implementation avoids drift between Library card / Organize
 * editor / Export / Publish / Storage stats.
 */

export interface VideoChapter {
  startSec: number;
  title: string;
}

/**
 * Normalize a user-typed keyword query: strip leading `#` (or `##`...)
 * and surrounding whitespace. Both the keywords API and the hashtag
 * scraper use this so the stored query field, the seeded video tag,
 * and the URL all share one canonical form.
 *
 * `#prompt-caching` → `prompt-caching`
 * ` ##AI ` → `AI`
 * `   ` → `` (empty — caller should reject)
 */
export function cleanKeywordQuery(raw: string): string {
  // Trim first so leading whitespace doesn't hide the `#` from the regex.
  return raw.trim().replace(/^#+/, '').trim();
}

/**
 * Parse a stored `videos.tags` value into a string array. Accepts:
 *   - JSON-encoded array (canonical: `["ai","api"]`)
 *   - Comma / semicolon separated plain string (legacy / user typed)
 *   - null / undefined → empty array
 *
 * De-duplicates case-insensitively while preserving the first occurrence's
 * casing — guards against AI summaries that occasionally emit `["AI",
 * "ai", "API"]` so we don't render three nearly-identical chips.
 */
export function parseVideoTags(raw?: string | null): string[] {
  if (!raw) return [];
  let candidates: string[] = [];
  // Track whether JSON.parse succeeded as an array — empty arrays are
  // a legitimate result and must NOT fall through to comma-split (a
  // canonical empty-tags string `'[]'` should yield 0 tags, not 1).
  let parsedAsArray = false;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsedAsArray = true;
      candidates = parsed.filter((t): t is string => typeof t === 'string');
    }
  } catch {
    /* fall through to comma split */
  }
  if (!parsedAsArray && candidates.length === 0) {
    candidates = raw
      .split(/[,，;；]/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of candidates) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Parse a stored `videos.chapters` JSON value into typed chapters.
 * Returns [] for invalid / missing / non-array payloads. Items missing a
 * title are dropped; items missing startSec default to 0.
 */
export function parseVideoChapters(raw?: string | null): VideoChapter[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => {
        if (!c || typeof c !== 'object') return null;
        const obj = c as Record<string, unknown>;
        const start = typeof obj.startSec === 'number' ? obj.startSec : 0;
        const title = typeof obj.title === 'string' ? obj.title : '';
        if (!title) return null;
        return { startSec: start, title };
      })
      .filter((c): c is VideoChapter => c !== null);
  } catch {
    return [];
  }
}

/**
 * Parse a stored `transcripts.segments` JSON value into a string-only
 * line list (drops timing). Used by export and publish where free text
 * is what's needed; the timed view stays in TranscriptPanel.
 */
export function parseTranscriptText(raw?: string | null): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return '';
    return parsed
      .map((s) => (s && typeof s === 'object' && typeof s.text === 'string' ? s.text : ''))
      .filter((t) => t)
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * Like parseTranscriptText but keeps the per-segment startSec timing as
 * an inline marker, formatted `[Tm:Ss] line`. Enables the AI summary
 * call to produce chapter `startSec` values grounded in real timestamps
 * rather than guessing from word density.
 *
 * Falls back to plain text (no timestamps) when segments are malformed.
 *
 * Round 174: replaces the plain `parseTranscriptText` in ai-summary's
 * prompt — chapters' `startSec` was previously hallucinated.
 */
export function formatTimedTranscript(raw?: string | null): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return '';
    return parsed
      .filter(
        (s): s is { startSec?: number; text?: string } =>
          !!s && typeof s === 'object' && typeof (s as { text?: unknown }).text === 'string',
      )
      .map((s) => {
        const t = (s.text ?? '').trim();
        if (!t) return '';
        const sec = typeof s.startSec === 'number' && Number.isFinite(s.startSec) ? s.startSec : 0;
        const m = Math.floor(sec / 60);
        const ss = Math.floor(sec % 60).toString().padStart(2, '0');
        return `[${m}:${ss}] ${t}`;
      })
      .filter((line) => line)
      .join('\n');
  } catch {
    return '';
  }
}
