/**
 * Parse free-form Douyin profile / video input into structured fields.
 *
 * Supported forms:
 *   - sec_uid string ("MS4wLjABAAAA...")
 *   - profile URL: https://www.douyin.com/user/<sec_uid>
 *   - Douyin app share card text containing a profile / short URL
 *   - short profile URL: https://v.douyin.com/<token>/  (resolved later via MCP)
 *   - video URL:   https://www.douyin.com/video/<aweme_id>
 *   - short video URL: https://v.douyin.com/<token>/   (resolved later)
 *   - aweme_id string ("76xxxxxxxxxxxxxxxxx")
 *
 * Resolving short links to canonical URLs is the MCP layer's job; here we
 * normalize what the user typed so the backend always sees a consistent
 * { kind, secUid?, awemeId?, shortToken?, original } shape.
 */

export type ParsedDouyinInput =
  | { kind: 'sec_uid'; secUid: string; original: string }
  | { kind: 'profile-url'; secUid: string; original: string }
  | { kind: 'aweme_id'; awemeId: string; original: string }
  | { kind: 'video-url'; awemeId: string; original: string }
  | { kind: 'short-url'; shortToken: string; original: string }
  | { kind: 'unknown'; original: string };

const SEC_UID_RE = /^[A-Za-z0-9_-]{20,}$/;
const AWEME_ID_RE = /^\d{15,21}$/;
const DOUYIN_URL_IN_TEXT_RE =
  /(?:https?:\/\/)?(?:www\.|m\.|v\.)?(?:douyin\.com|iesdouyin\.com)\/[^\s<>"'，。！？；、]+/i;

export function parseDouyinInput(raw: string): ParsedDouyinInput {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { kind: 'unknown', original: raw ?? '' };

  if (SEC_UID_RE.test(trimmed) && trimmed.startsWith('MS')) {
    return { kind: 'sec_uid', secUid: trimmed, original: trimmed };
  }
  if (AWEME_ID_RE.test(trimmed)) {
    return { kind: 'aweme_id', awemeId: trimmed, original: trimmed };
  }

  const candidate = normalizeDouyinUrlCandidate(trimmed);
  let url: URL | null = null;
  try {
    url = new URL(candidate);
  } catch {
    url = null;
  }
  if (!url) return { kind: 'unknown', original: trimmed };

  const host = url.hostname.toLowerCase();

  if (host === 'v.douyin.com') {
    const token = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    if (token) return { kind: 'short-url', shortToken: token, original: trimmed };
  }

  if (
    host === 'www.douyin.com' ||
    host === 'douyin.com' ||
    host === 'm.douyin.com' ||
    host === 'www.iesdouyin.com' ||
    host === 'iesdouyin.com'
  ) {
    const segments = url.pathname.split('/').filter(Boolean);
    const userIdx = findPathSegments(segments, ['user']) ?? findPathSegments(segments, ['share', 'user']);
    if (userIdx !== null && segments[userIdx + 1]) {
      const secUid = segments[userIdx + 1].split('?')[0];
      if (SEC_UID_RE.test(secUid)) {
        return { kind: 'profile-url', secUid, original: trimmed };
      }
    }
    const videoIdx =
      findPathSegments(segments, ['video']) ?? findPathSegments(segments, ['share', 'video']);
    if (videoIdx !== null && segments[videoIdx + 1]) {
      const awemeId = segments[videoIdx + 1].split('?')[0];
      if (AWEME_ID_RE.test(awemeId)) {
        return { kind: 'video-url', awemeId, original: trimmed };
      }
    }
  }

  return { kind: 'unknown', original: trimmed };
}

function normalizeDouyinUrlCandidate(input: string): string {
  const matched = input.match(DOUYIN_URL_IN_TEXT_RE)?.[0] ?? input;
  const stripped = matched.replace(/[，。！？；、,.)\]}>"']+$/u, '');
  return /^https?:\/\//i.test(stripped) ? stripped : `https://${stripped}`;
}

function findPathSegments(segments: string[], pattern: string[]): number | null {
  for (let idx = 0; idx <= segments.length - pattern.length; idx += 1) {
    const matches = pattern.every((part, offset) => segments[idx + offset] === part);
    if (matches) return idx + pattern.length - 1;
  }
  return null;
}
