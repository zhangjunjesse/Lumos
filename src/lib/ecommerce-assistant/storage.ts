import type { AppDataStore, AppRow } from '@/lib/app/runtime/data-store';
import { getAppPlatformService } from '@/lib/app/service';
import { createAppDataStore } from '@/lib/app/runtime/data-store';
import { ECOMMERCE_ASSISTANT_APP_ID } from './constants';
import type {
  DiscoverCandidateRecord,
  DiscoverCandidateStatus,
  ImageJobRecord,
  ImageJobStatus,
  ImageOutputKind,
  ImageOutputRecord,
  ListingDraftRecord,
  ListingDraftStatus,
  ProductBriefRecord,
  ProductInputRecord,
  StylePresetRecord,
} from './types';

export type ProductInputRow = AppRow<ProductInputRecord>;
export type ImageJobRow = AppRow<ImageJobRecord>;
export type ImageOutputRow = AppRow<ImageOutputRecord>;
export type ProductBriefRow = AppRow<ProductBriefRecord>;
export type StylePresetRow = AppRow<StylePresetRecord>;
export type DiscoverCandidateRow = AppRow<DiscoverCandidateRecord>;
export type ListingDraftRow = AppRow<ListingDraftRecord>;

export function getEcommerceStore(): AppDataStore {
  const svc = getAppPlatformService();
  return createAppDataStore(svc.db, ECOMMERCE_ASSISTANT_APP_ID);
}

export function ensureBuiltinStylePresets(store: AppDataStore): void {
  const existing = store.query<StylePresetRecord>('style_presets', {
    filter: { is_builtin: true },
    limit: 10,
  });
  const seenDirections = new Set(existing.map((row) => row.direction));
  for (const preset of BUILTIN_PRESETS) {
    if (seenDirections.has(preset.direction)) continue;
    store.create<Record<string, unknown>>('style_presets', {
      ...preset,
      is_builtin: true,
      enabled: true,
      negative_rules: JSON.stringify(preset.negative_rules ?? []),
    });
  }
}

const BUILTIN_PRESETS = [
  {
    name: '商品主图（catalog）',
    direction: 'catalog' as const,
    scene: 'clean premium marketplace scene with minimal background and strong product focus',
    composition: 'full product visibility, centered or slightly off-center, clean negative space',
    lighting: 'soft natural light with controlled product shadow',
    mood: 'clean, calm, premium, trustworthy',
    negative_rules: ['no clutter', 'no human', 'no pet', 'no extra products'],
  },
  {
    name: '生活场景（lifestyle）',
    direction: 'lifestyle' as const,
    scene:
      'believable real-life environment matching product usage, but still product-dominant',
    composition: '45-degree commercial angle with visible environment context',
    lighting: 'soft realistic daylight',
    mood: 'warm, believable, relaxed, welcoming',
    negative_rules: ['no blocked product', 'no exaggerated props', 'no text or watermark'],
  },
  {
    name: '高端宣传（campaign）',
    direction: 'campaign' as const,
    scene: 'premium commercial atmosphere with controlled styling and strong product dominance',
    composition: 'balanced hero composition with more depth but full product visibility',
    lighting: 'refined commercial light with clean highlights and shadow separation',
    mood: 'elevated, refined, polished, aspirational',
    negative_rules: [
      'no excessive drama',
      'no product deformation',
      'no extra branded elements',
    ],
  },
];

export function readReferenceImagePaths(input: ProductInputRecord): string[] {
  if (!input.reference_image_paths) return [];
  try {
    const parsed = JSON.parse(input.reference_image_paths);
    if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === 'string');
  } catch {
    // ignore malformed json
  }
  return [];
}

export function getInput(store: AppDataStore, id: string): ProductInputRow | null {
  return store.get<ProductInputRecord>('product_inputs', id);
}

export function listInputs(
  store: AppDataStore,
  filter?: Partial<ProductInputRecord>,
): ProductInputRow[] {
  return store.query<ProductInputRecord>('product_inputs', {
    filter: filter as Record<string, unknown> | undefined,
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 200,
  });
}

export function getJob(store: AppDataStore, id: string): ImageJobRow | null {
  return store.get<ImageJobRecord>('image_jobs', id);
}

export function listJobs(
  store: AppDataStore,
  filter?: Partial<ImageJobRecord>,
): ImageJobRow[] {
  return store.query<ImageJobRecord>('image_jobs', {
    filter: filter as Record<string, unknown> | undefined,
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 100,
  });
}

export function createJobRecord(
  store: AppDataStore,
  input: { input_id: string; preset_id?: string | null; aspect_ratio?: string | null },
): ImageJobRow {
  const now = new Date().toISOString();
  return store.create<ImageJobRecord>('image_jobs', {
    input_id: input.input_id,
    preset_id: input.preset_id ?? null,
    aspect_ratio: input.aspect_ratio ?? null,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    cutout_path: null,
    final_image_path: null,
    winner_direction: null,
    fallback_used: false,
    cutout_attempts: 0,
    scene_attempts: 0,
    refine_attempts: 0,
    failure_reason: null,
    failure_stage: null,
    summary: null,
    created_at: now,
    updated_at: now,
  });
}

export function patchJob(
  store: AppDataStore,
  id: string,
  patch: Partial<ImageJobRecord>,
): ImageJobRow | null {
  return store.update<ImageJobRecord>('image_jobs', id, patch);
}

export function recordJobStatus(
  store: AppDataStore,
  jobId: string,
  status: ImageJobStatus,
  patch: Partial<ImageJobRecord> = {},
): void {
  store.update<ImageJobRecord>('image_jobs', jobId, { ...patch, status });
}

export function appendOutput(
  store: AppDataStore,
  args: {
    job_id: string;
    input_id: string;
    kind: ImageOutputKind;
    iteration?: number;
    image_path: string;
    aspect_ratio?: string | null;
    qc_pass?: boolean;
    qc_score?: number;
    qc_summary?: string | null;
    qc_fail_reason?: string | null;
    prompt?: string | null;
    is_winner?: boolean;
  },
): ImageOutputRow {
  const now = new Date().toISOString();
  return store.create<ImageOutputRecord>('image_outputs', {
    job_id: args.job_id,
    input_id: args.input_id,
    kind: args.kind,
    iteration: args.iteration ?? 1,
    image_path: args.image_path,
    aspect_ratio: args.aspect_ratio ?? null,
    qc_pass: args.qc_pass ?? false,
    qc_score: args.qc_score,
    qc_summary: args.qc_summary ?? null,
    qc_fail_reason: args.qc_fail_reason ?? null,
    prompt: args.prompt ?? null,
    is_winner: args.is_winner ?? false,
    created_at: now,
    updated_at: now,
  });
}

export function upsertBrief(
  store: AppDataStore,
  args: { input_id: string; brief: Record<string, unknown>; raw: string; confidence?: number },
): ProductBriefRow {
  const existing = store
    .query<ProductBriefRecord>('product_briefs', { filter: { input_id: args.input_id }, limit: 1 })
    .at(0);
  const fields: Partial<ProductBriefRecord> = {
    input_id: args.input_id,
    product_type: String(args.brief.productType ?? '') || null,
    category_bucket: String(args.brief.categoryBucket ?? '') || null,
    size_class: String(args.brief.sizeClass ?? '') || null,
    core_selling_points: JSON.stringify(args.brief.coreSellingPoints ?? []),
    target_audience: JSON.stringify(args.brief.targetAudience ?? []),
    recommended_aspect_ratio: String(args.brief.recommendedAspectRatio ?? '4:5'),
    recommended_shot_type: String(args.brief.recommendedShotType ?? '') || null,
    fidelity_focus: JSON.stringify(args.brief.fidelityFocus ?? []),
    consistency_anchors: JSON.stringify(args.brief.consistencyAnchors ?? []),
    avoid_elements: JSON.stringify(args.brief.avoidElements ?? []),
    raw_brief: args.raw,
    confidence: args.confidence ?? null,
  };
  if (existing) {
    return (
      store.update<ProductBriefRecord>('product_briefs', existing.id, fields) ?? existing
    );
  }
  return store.create<ProductBriefRecord>('product_briefs', fields as ProductBriefRecord);
}

export function listOutputs(
  store: AppDataStore,
  filter?: Partial<ImageOutputRecord>,
): ImageOutputRow[] {
  return store.query<ImageOutputRecord>('image_outputs', {
    filter: filter as Record<string, unknown> | undefined,
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 200,
  });
}

export function listCandidates(
  store: AppDataStore,
  filter?: Partial<DiscoverCandidateRecord>,
): DiscoverCandidateRow[] {
  return store.query<DiscoverCandidateRecord>('discover_candidates', {
    filter: filter as Record<string, unknown> | undefined,
    orderBy: { field: 'score_total', direction: 'desc' },
    limit: 200,
  });
}

export function getCandidate(
  store: AppDataStore,
  id: string,
): DiscoverCandidateRow | null {
  return store.get<DiscoverCandidateRecord>('discover_candidates', id);
}

export function createCandidate(
  store: AppDataStore,
  input: Omit<DiscoverCandidateRecord, 'id' | 'created_at' | 'updated_at'>,
): DiscoverCandidateRow {
  const now = new Date().toISOString();
  return store.create<DiscoverCandidateRecord>(
    'discover_candidates',
    // TS spread narrowing on Omit<X, K> + filling K can lose track of X's
    // remaining required keys; cast back to the full record after spread.
    { ...input, created_at: now, updated_at: now } as DiscoverCandidateRecord,
  );
}

export function patchCandidate(
  store: AppDataStore,
  id: string,
  patch: Partial<DiscoverCandidateRecord>,
): DiscoverCandidateRow | null {
  return store.update<DiscoverCandidateRecord>('discover_candidates', id, patch);
}

export function setCandidateStatus(
  store: AppDataStore,
  id: string,
  status: DiscoverCandidateStatus,
  patch: Partial<DiscoverCandidateRecord> = {},
): void {
  store.update<DiscoverCandidateRecord>('discover_candidates', id, { ...patch, status });
}

export function listListingDrafts(
  store: AppDataStore,
  filter?: Partial<ListingDraftRecord>,
): ListingDraftRow[] {
  return store.query<ListingDraftRecord>('listing_drafts', {
    filter: filter as Record<string, unknown> | undefined,
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 200,
  });
}

export function getListingDraft(
  store: AppDataStore,
  id: string,
): ListingDraftRow | null {
  return store.get<ListingDraftRecord>('listing_drafts', id);
}

export function createListingDraft(
  store: AppDataStore,
  input: Omit<ListingDraftRecord, 'id' | 'created_at' | 'updated_at'>,
): ListingDraftRow {
  const now = new Date().toISOString();
  return store.create<ListingDraftRecord>('listing_drafts', {
    ...input,
    created_at: now,
    updated_at: now,
  } as ListingDraftRecord);
}

export function patchListingDraft(
  store: AppDataStore,
  id: string,
  patch: Partial<ListingDraftRecord>,
): ListingDraftRow | null {
  return store.update<ListingDraftRecord>('listing_drafts', id, patch);
}

export function setListingDraftStatus(
  store: AppDataStore,
  id: string,
  status: ListingDraftStatus,
  patch: Partial<ListingDraftRecord> = {},
): void {
  store.update<ListingDraftRecord>('listing_drafts', id, { ...patch, status });
}
