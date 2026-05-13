export const ECOMMERCE_ASSISTANT_APP_ID = 'ecommerce-assistant';
export const ECOMMERCE_ASSISTANT_VERSION = '0.1.0';

export const SOP_LIMITS = {
  cutoutAttempts: 2,
  sceneAttempts: 3,
  refineAttempts: 2,
  /**
   * After the main image is finalized, we generate this many detail-carousel
   * images. Each failure is independent — a partial set is still useful.
   */
  detailSetMaxRetryPerSlot: 1,
} as const;

export const DEFAULT_ASPECT_RATIO = '4:5';

export type DetailSlotId = 'detail-hero' | 'detail-feature' | 'detail-lifestyle' | 'detail-scale';

export interface DetailSlotSpec {
  id: DetailSlotId;
  /** Human label for diagnostics / UI grouping. */
  label: string;
  /** How many distinct images this slot produces (e.g. 2 different feature angles). */
  count: number;
  /** Aspect ratio override for the slot; falls back to brief.recommendedAspectRatio. */
  aspectRatio?: string;
}

/**
 * The default detail-page carousel composition. Designed to mirror what most
 * marketplaces (Amazon, TikTok Shop, Shopify) render below the main image:
 * one premium white-bg variant, two close-ups of distinguishing features,
 * two lifestyle-in-use shots, one scale reference. 6 images total.
 */
export const DEFAULT_DETAIL_SLOTS: DetailSlotSpec[] = [
  { id: 'detail-hero', label: '高端白底主图', count: 1 },
  { id: 'detail-feature', label: '卖点特写', count: 2 },
  { id: 'detail-lifestyle', label: '使用场景', count: 2 },
  { id: 'detail-scale', label: '尺寸 / 手持参照', count: 1 },
];
