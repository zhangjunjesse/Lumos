/**
 * Parse free-form Douyin profile / video input into structured fields.
 *
 * Supported forms:
 *   - sec_uid string ("MS4wLjABAAAA...")
 *   - profile URL: https://www.douyin.com/user/<sec_uid>
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

export function parseDouyinInput(raw: string): ParsedDouyinInput {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { kind: 'unknown', original: raw ?? '' };

  if (SEC_UID_RE.test(trimmed) && trimmed.startsWith('MS')) {
    return { kind: 'sec_uid', secUid: trimmed, original: trimmed };
  }
  if (AWEME_ID_RE.test(trimmed)) {
    return { kind: 'aweme_id', awemeId: trimmed, original: trimmed };
  }

  let url: URL | null = null;
  try {
    url = new URL(trimmed);
  } catch {
    url = null;
  }
  if (!url) return { kind: 'unknown', original: trimmed };

  const host = url.hostname.toLowerCase();

  if (host === 'v.douyin.com') {
    const token = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    if (token) return { kind: 'short-url', shortToken: token, original: trimmed };
  }

  if (host === 'www.douyin.com' || host === 'douyin.com' || host === 'm.douyin.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    const userIdx = segments.indexOf('user');
    if (userIdx >= 0 && segments[userIdx + 1]) {
      const secUid = segments[userIdx + 1].split('?')[0];
      if (SEC_UID_RE.test(secUid)) {
        return { kind: 'profile-url', secUid, original: trimmed };
      }
    }
    const videoIdx = segments.indexOf('video');
    if (videoIdx >= 0 && segments[videoIdx + 1]) {
      const awemeId = segments[videoIdx + 1].split('?')[0];
      if (AWEME_ID_RE.test(awemeId)) {
        return { kind: 'video-url', awemeId, original: trimmed };
      }
    }
  }

  return { kind: 'unknown', original: trimmed };
}
