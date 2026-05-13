'use client';

import * as React from 'react';

import {
  creatorQualityTier,
  type CreatorQualityTier,
} from '@/lib/douyin-collector/creator-quality';

const TIER_STYLE: Record<CreatorQualityTier, string> = {
  high: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  low: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  none: '',
};

const TIER_LABEL: Record<CreatorQualityTier, string> = {
  high: '高质量',
  medium: '一般',
  low: '低产出',
  none: '',
};

/**
 * Coarse quality pill used by both CreatorSection and KeywordSection.
 * Renders as an inline chip with emerald/amber/rose tint based on
 * publish-rate tiers (see `creatorQualityTier`). Returns null when
 * sample size is too small to classify — keeps the row clean.
 */
export function QualityPill({
  stats,
}: {
  stats: { collected: number; transcribed: number; published: number };
}): React.ReactElement | null {
  const { tier, publishRate } = creatorQualityTier(stats);
  if (tier === 'none' || publishRate === null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TIER_STYLE[tier]}`}
      title={`入库率 ${(publishRate * 100).toFixed(0)}% · ${stats.published}/${stats.collected}`}
    >
      {TIER_LABEL[tier]} · {(publishRate * 100).toFixed(0)}%
    </span>
  );
}
