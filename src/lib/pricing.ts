/**
 * Lumos Cloud quota / pricing helpers.
 *
 * Cloud-side prices are stored as integer "quota units per 1M tokens" so
 * `lumos-web` can avoid floating point at the billing edge. Display layer
 * converts to RMB (¥) for the user.
 */

/** 500,000 quota units == ¥1. Pricing fields are denominated in quota
 * units per 1M tokens, so dividing by this constant yields ¥/1M tokens. */
export const QUOTA_UNITS_PER_YUAN = 500_000;

/**
 * Format a per-Mtok price (in quota units) as a short ¥ string.
 * Returns null when the value is missing/non-positive so callers can
 * gracefully omit the price line.
 */
export function formatYuanPerMtok(units: number | undefined | null): string | null {
  if (!units || !Number.isFinite(units) || units <= 0) return null;
  const yuan = units / QUOTA_UNITS_PER_YUAN;
  if (yuan >= 10) return `¥${yuan.toFixed(0)}`;
  if (yuan >= 1) return `¥${yuan.toFixed(1).replace(/\.0$/, '')}`;
  return `¥${yuan.toFixed(2)}`;
}
