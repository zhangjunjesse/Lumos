import type { ResearchReport } from './types';

const PLATFORM_SEPARATOR = /[\s,，;；、|]+/;

/**
 * Parse the platform input field into a clean list of unique, trimmed,
 * lowercase platform keys. Accepts comma / whitespace / Chinese-comma /
 * semicolon / pipe separators so "etsy, amazon walmart" works as one would
 * expect.
 *
 * Returns at most `max` platforms — anything beyond gets dropped silently
 * so a runaway input doesn't try to fire 100 API calls.
 */
export function parsePlatformInput(raw: string, max = 6): string[] {
  const tokens = String(raw ?? '')
    .split(PLATFORM_SEPARATOR)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Cluster reports by (query, ~5min window of created_at) so a multi-platform
 * submission shows up as one "batch" the user can scan across.
 *
 * Output preserves the input order (which is reverse-chronological in our
 * data hook), placing each batch at the position of its earliest member.
 * Single-report batches are passed through unchanged.
 */
export interface ResearchReportBatch {
  key: string;
  query: string;
  earliestAt: string;
  reports: ResearchReport[];
}

const BATCH_WINDOW_MS = 5 * 60 * 1000;

export function clusterReportsByBatch(reports: readonly ResearchReport[]): ResearchReportBatch[] {
  // Group: same query + created_at within 5min of any other in the group.
  const groups: ResearchReportBatch[] = [];
  for (const r of reports) {
    const ts = parseTs(r.created_at);
    const q = (r.query ?? '').trim();
    // Find an existing group that matches.
    const target = groups.find((g) => {
      if (g.query !== q) return false;
      const earliest = parseTs(g.earliestAt);
      return Math.abs((ts ?? 0) - (earliest ?? 0)) <= BATCH_WINDOW_MS;
    });
    if (target) {
      target.reports.push(r);
      // Keep earliestAt as the min.
      if (ts !== null && (parseTs(target.earliestAt) ?? Infinity) > ts) {
        target.earliestAt = r.created_at ?? target.earliestAt;
      }
    } else {
      groups.push({
        key: `${q}|${r.created_at ?? r.id}`,
        query: q,
        earliestAt: r.created_at ?? '',
        reports: [r],
      });
    }
  }
  return groups;
}

function parseTs(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}
