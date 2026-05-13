/**
 * Download and parse douyin native subtitle files. Douyin's caption_infos
 * URLs typically point to either WebVTT (.vtt) or a JSON-shaped caption
 * structure. We try both shapes and fall back to plain-text extraction.
 *
 * Honest contract: on HTTP error, unsupported format, or empty content we
 * return `{ ok: false, reason }` — no synthetic captions.
 */

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export type TranscriptFetchOutcome =
  | {
      ok: true;
      segments: TranscriptSegment[];
      wordCount: number;
      sourceFormat: 'vtt' | 'json' | 'plain';
    }
  | { ok: false; reason: string };

export async function fetchAndParseSubtitle(url: string): Promise<TranscriptFetchOutcome> {
  let body: string;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      return { ok: false, reason: `字幕 URL 返回 HTTP ${res.status}。` };
    }
    body = await res.text();
  } catch (err) {
    return {
      ok: false,
      reason: `字幕 URL 请求失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return parseSubtitleBody(body);
}

export function parseSubtitleBody(body: string): TranscriptFetchOutcome {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, reason: '字幕内容为空。' };

  // Try JSON first — douyin sometimes returns a JSON structure with
  // `utterances` or similar fields.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const segs = extractFromJson(parsed);
      if (segs.length > 0) {
        return finishOutcome(segs, 'json');
      }
    } catch {
      // not valid JSON — fall through to VTT
    }
  }

  // VTT: starts with "WEBVTT" header, cues separated by blank lines.
  if (/^WEBVTT/i.test(trimmed)) {
    const segs = parseVtt(trimmed);
    if (segs.length > 0) return finishOutcome(segs, 'vtt');
  }

  // Last resort: strip HTML/SRT-style timing and return plain text.
  const plain = trimmed
    .replace(/^\d+\s*$/gm, '')
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length === 0) return { ok: false, reason: '字幕格式不可识别（既不是 VTT 也不是 JSON）。' };
  return finishOutcome(
    [{ startSec: 0, endSec: 0, text: plain }],
    'plain',
  );
}

function extractFromJson(payload: unknown): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    // Common shape: { utterances: [{ start_time, end_time, text }] } or
    // { sentences: [...] } or a list of cues.
    const list =
      asArray(obj.utterances) ?? asArray(obj.sentences) ?? asArray(obj.cues);
    if (list) {
      for (const cue of list) {
        if (!cue || typeof cue !== 'object') continue;
        const c = cue as Record<string, unknown>;
        const text =
          (typeof c.text === 'string' && c.text) ||
          (typeof c.utterance === 'string' && c.utterance) ||
          '';
        if (!text) continue;
        const start = numberOrZero(c.start_time ?? c.startTime ?? c.start);
        const end = numberOrZero(c.end_time ?? c.endTime ?? c.end);
        out.push({ startSec: msToSec(start), endSec: msToSec(end), text: text.trim() });
      }
    }
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (Array.isArray(v) || (v && typeof v === 'object')) visit(v);
    }
  };
  visit(payload);
  return out;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function numberOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Treat large values (> 24h in seconds) as milliseconds. */
function msToSec(v: number): number {
  if (v <= 0) return 0;
  return v > 86_400 ? Math.round(v / 1000) : Math.round(v);
}

const VTT_TIME = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g;

export function parseVtt(body: string): TranscriptSegment[] {
  const lines = body.split(/\r?\n/);
  const out: TranscriptSegment[] = [];
  let cueStart: number | null = null;
  let cueEnd: number | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (cueStart != null && cueEnd != null && buffer.length > 0) {
      out.push({
        startSec: cueStart,
        endSec: cueEnd,
        text: buffer.join(' ').trim(),
      });
    }
    cueStart = cueEnd = null;
    buffer = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'WEBVTT' || line === '') {
      if (line === '') flush();
      continue;
    }
    if (line.includes('-->')) {
      const matches = [...line.matchAll(VTT_TIME)];
      if (matches.length >= 2) {
        cueStart = vttMatchToSec(matches[0]);
        cueEnd = vttMatchToSec(matches[1]);
      }
      continue;
    }
    if (cueStart != null && cueEnd != null) {
      buffer.push(line.replace(/<[^>]+>/g, ''));
    }
  }
  flush();
  return out;
}

function vttMatchToSec(m: RegExpMatchArray): number {
  const h = parseInt(m[1] ?? '0', 10);
  const min = parseInt(m[2] ?? '0', 10);
  const s = parseInt(m[3] ?? '0', 10);
  return h * 3600 + min * 60 + s;
}

function finishOutcome(
  segments: TranscriptSegment[],
  sourceFormat: 'vtt' | 'json' | 'plain',
): TranscriptFetchOutcome {
  const wordCount = segments.reduce((acc, s) => acc + s.text.length, 0);
  return { ok: true, segments, wordCount, sourceFormat };
}
