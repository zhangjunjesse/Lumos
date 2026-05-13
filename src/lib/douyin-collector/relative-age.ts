/**
 * Format an ISO timestamp as a coarse "X 时间前" label and expose `hours`
 * so callers can decide if the value is stale enough to highlight.
 *
 * Pure helper used across the douyin-collector UI: Hero (cookie /
 * patrol / publish age) and RecentRunsPanel (per-row time). Single
 * source of truth for relative-time formatting in the app.
 *
 * Buckets:
 *   < 1 min       → "刚刚"
 *   < 1 hour      → "N 分钟前"
 *   < 48 hours    → "N 小时前"
 *   < 30 days     → "N 天前"
 *   < ~1 year     → "N 个月前"  (months floor < 12)
 *   ≥ ~1 year     → "N 年前"
 *
 * `hours` is computed even for "刚刚" so callers can compare against
 * thresholds (e.g. cookie staleness gate at 36h).
 */
export function relativeAge(iso: string | null): { label: string; hours: number | null } {
  if (!iso) return { label: '未知', hours: null };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { label: '未知', hours: null };
  const ms = Date.now() - t;
  if (ms < 0) return { label: '刚刚', hours: 0 };
  const hours = ms / 3_600_000;
  if (ms < 60_000) return { label: '刚刚', hours };
  if (ms < 60 * 60_000) return { label: `${Math.floor(ms / 60_000)} 分钟前`, hours };
  if (hours < 48) return { label: `${Math.floor(hours)} 小时前`, hours };
  const days = Math.floor(hours / 24);
  if (days < 30) return { label: `${days} 天前`, hours };
  // ~30 day month for display purposes; calendar precision isn't useful
  // at this granularity (the Hero shows it as "stale-ish" anyway).
  const months = Math.floor(days / 30);
  if (months < 12) return { label: `${months} 个月前`, hours };
  const years = Math.floor(months / 12);
  return { label: `${years} 年前`, hours };
}
