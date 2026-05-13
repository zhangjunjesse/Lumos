/**
 * Pure helper for classifying a creator's "library quality" based on the
 * stats we already collect (statsByCreator). Surfaces a coarse tier the
 * UI can render as a colored pill — gives the user signal about which
 * subscriptions are pulling their weight.
 */

export type CreatorQualityTier = 'high' | 'medium' | 'low' | 'none';

export interface CreatorQualityInput {
  collected: number;
  published: number;
  transcribed: number;
}

const MIN_SAMPLES_FOR_TIER = 5;
const HIGH_THRESHOLD = 0.5;
const MEDIUM_THRESHOLD = 0.2;

/**
 * Tier the creator by their published-rate (published / collected).
 *
 * Honest contract:
 *   - Returns 'none' for fewer than MIN_SAMPLES_FOR_TIER (5) collected
 *     videos — small samples are noise; pretending they're "high" or
 *     "low" misleads the user.
 *   - 'high' (>= 50%): user finds most videos worth keeping → keep
 *     subscribing
 *   - 'medium' (20–50%): mixed; transcript / summary may need review
 *   - 'low' (< 20%): user discards most → reconsider subscribing
 *
 * Returns the rate as well so callers can show "X% 入库率" alongside
 * the tier pill.
 */
export function creatorQualityTier(input: CreatorQualityInput): {
  tier: CreatorQualityTier;
  publishRate: number | null;
} {
  if (input.collected <= 0) return { tier: 'none', publishRate: null };
  if (input.collected < MIN_SAMPLES_FOR_TIER) {
    return { tier: 'none', publishRate: input.published / input.collected };
  }
  const rate = input.published / input.collected;
  if (rate >= HIGH_THRESHOLD) return { tier: 'high', publishRate: rate };
  if (rate >= MEDIUM_THRESHOLD) return { tier: 'medium', publishRate: rate };
  return { tier: 'low', publishRate: rate };
}
