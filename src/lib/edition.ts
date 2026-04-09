/**
 * Lumos Edition detection.
 *
 * NEXT_PUBLIC_LUMOS_EDITION is set at build time:
 *   - "pro"  → 会员版 (built-in Lumos Cloud provider, login flow)
 *   - "open" → 开放版 (user manages own providers/keys)
 *
 * Default: "open" (backwards-compatible)
 */

export type LumosEdition = 'open' | 'pro';

const RAW = (process.env.NEXT_PUBLIC_LUMOS_EDITION ?? 'open').trim().toLowerCase();

export const EDITION: LumosEdition = RAW === 'pro' ? 'pro' : 'open';

export function isPro(): boolean {
  return EDITION === 'pro';
}

export function isOpen(): boolean {
  return EDITION === 'open';
}
