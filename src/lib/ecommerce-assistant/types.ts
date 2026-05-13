export type ImageJobStatus =
  | 'queued'
  | 'preprocessing'
  | 'identifying'
  | 'cutting'
  | 'planning'
  | 'generating'
  | 'scoring'
  | 'refining'
  | 'qc'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ImageOutputKind =
  | 'cutout'
  | 'catalog'
  | 'lifestyle'
  | 'campaign'
  | 'final'
  | 'fallback'
  // Detail-page set, generated after the main image is finalized. Each slot
  // serves a distinct purpose in the storefront detail carousel.
  | 'detail-hero'
  | 'detail-feature'
  | 'detail-lifestyle'
  | 'detail-scale';

/*
 * Records below describe the field set we persist into AppDataStore. The store
 * adds `id` (and timestamps) to every row it returns; we intentionally omit
 * `id` here so create-call sites don't have to forge an empty placeholder.
 * Reads return AppRow<T> from the data-store, which materializes id back in.
 */

export interface ProductInputRecord extends Record<string, unknown> {
  id?: string;
  title: string;
  category_hint?: string | null;
  main_image_path: string;
  reference_image_paths?: string | null;
  note?: string | null;
  status: 'ready' | 'archived';
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProductBriefRecord extends Record<string, unknown> {
  id?: string;
  input_id: string;
  product_type?: string | null;
  category_bucket?: string | null;
  size_class?: string | null;
  core_selling_points?: string | null;
  target_audience?: string | null;
  recommended_aspect_ratio?: string | null;
  recommended_shot_type?: string | null;
  fidelity_focus?: string | null;
  consistency_anchors?: string | null;
  avoid_elements?: string | null;
  raw_brief?: string | null;
  confidence?: number | null;
  updated_at?: string | null;
}

export interface ImageJobRecord extends Record<string, unknown> {
  id?: string;
  input_id: string;
  preset_id?: string | null;
  aspect_ratio?: string | null;
  status: ImageJobStatus;
  stage?: string | null;
  progress?: number | null;
  cutout_path?: string | null;
  final_image_path?: string | null;
  winner_direction?: string | null;
  fallback_used?: boolean | null;
  cutout_attempts?: number | null;
  scene_attempts?: number | null;
  refine_attempts?: number | null;
  failure_reason?: string | null;
  failure_stage?: string | null;
  summary?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ImageOutputRecord extends Record<string, unknown> {
  id?: string;
  job_id: string;
  input_id?: string | null;
  kind: ImageOutputKind;
  iteration?: number | null;
  image_path: string;
  thumbnail_path?: string | null;
  aspect_ratio?: string | null;
  qc_pass?: boolean | null;
  qc_score?: number | null;
  qc_summary?: string | null;
  qc_fail_reason?: string | null;
  prompt?: string | null;
  is_winner?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type ListingDraftStatus =
  | 'drafting'
  | 'ready'
  | 'failed'
  | 'archived'
  | 'submitted'
  | 'live'
  | 'rejected';

export type ListingPlatform =
  | 'amazon-us'
  | 'amazon-uk'
  | 'amazon-jp'
  | 'amazon-de'
  | 'tiktok-shop-us'
  | 'etsy'
  | 'shopify-dtc'
  | 'shopee-sg'
  | 'lazada-sg'
  | 'walmart';

export interface ListingDraftRecord extends Record<string, unknown> {
  id?: string;
  input_id: string;
  platform: ListingPlatform;
  language: string;
  title?: string | null;
  bullets?: string | null;
  description?: string | null;
  search_keywords?: string | null;
  warnings?: string | null;
  status: ListingDraftStatus;
  failure_reason?: string | null;
  submitted_at?: string | null;
  live_at?: string | null;
  live_url?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  user_notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type DiscoverCandidateStatus = 'researching' | 'ready' | 'failed' | 'promoted';

export type ListingFollowupStatus = 'pending' | 'done' | 'skipped';

export type ListingFollowupTemplateId =
  | 'check-first-order'
  | 'check-search-rank'
  | 'check-first-review'
  | 'set-ad-budget'
  | 'check-bsr-week'
  | 'review-week-summary'
  | 'check-conversion-rate';

export interface ListingFollowupRecord extends Record<string, unknown> {
  id?: string;
  draft_id: string;
  input_id: string;
  template_id: ListingFollowupTemplateId;
  title: string;
  description?: string | null;
  due_at: string;
  status: ListingFollowupStatus;
  done_at?: string | null;
  note?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type AuditEventKind =
  | 'candidate-promoted'
  | 'main-image-uploaded'
  | 'main-image-set-from-concept'
  | 'brief-identified'
  | 'brief-edited'
  | 'listing-drafted'
  | 'listing-edited'
  | 'listing-regenerated'
  | 'listing-status-changed';

export interface AuditEventRecord extends Record<string, unknown> {
  id?: string;
  kind: AuditEventKind;
  /** primary subject id this event is about (input_id / draft_id / candidate_id) */
  target_id: string;
  target_type: 'input' | 'listing' | 'candidate';
  /** the input_id this event ultimately rolls up to (for product-detail filtering); same as target_id when target is an input */
  input_id?: string | null;
  /** small structured detail about the change, JSON-stringified */
  payload?: string | null;
  /** human-readable one-line summary for activity feeds */
  summary?: string | null;
  occurred_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DiscoverCandidateRecord extends Record<string, unknown> {
  id?: string;
  research_id: string;
  keyword: string;
  market: string;
  price_band?: string | null;
  product_name: string;
  category: string;
  estimated_price_usd?: number | null;
  score_demand?: number | null;
  score_competition?: number | null;
  score_profit?: number | null;
  score_compliance?: number | null;
  score_logistics?: number | null;
  score_total?: number | null;
  summary?: string | null;
  selling_points?: string | null;
  risks?: string | null;
  differentiation?: string | null;
  reference_urls?: string | null;
  source_search_urls?: string | null;
  concept_image_path?: string | null;
  concept_image_failed?: string | null;
  platform_focus?: string | null;
  strategy?: string | null;
  sources?: string | null;
  status: DiscoverCandidateStatus;
  promoted_input_id?: string | null;
  failure_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface StylePresetRecord extends Record<string, unknown> {
  id?: string;
  name: string;
  direction: 'catalog' | 'lifestyle' | 'campaign' | 'custom';
  scene?: string | null;
  composition?: string | null;
  lighting?: string | null;
  mood?: string | null;
  negative_rules?: string | null;
  is_builtin?: boolean | null;
  enabled?: boolean | null;
  updated_at?: string | null;
}

export interface SopStageEvent {
  jobId: string;
  status: ImageJobStatus;
  stage: string;
  progress: number;
  message?: string;
}

export interface SopFailure {
  stage: string;
  reason: string;
}

export interface ProductBrief {
  productType: string;
  categoryBucket: string;
  sizeClass: 'small' | 'medium' | 'large';
  channelGoal: 'marketplace_hero';
  coreSellingPoints: string[];
  targetAudience: string[];
  recommendedUsageScenes: string[];
  recommendedPlacement: string[];
  recommendedSurfaceType: string;
  recommendedShotType: 'packshot' | 'tabletop' | 'room_scene' | 'hero_closeup';
  recommendedLighting: string;
  recommendedCameraAngle: string;
  recommendedLensStyle: string;
  recommendedDepthOfField: 'deep' | 'moderate' | 'shallow';
  recommendedShadowStyle: 'soft_natural' | 'crisp_controlled' | 'diffused';
  recommendedColorTemperature: 'warm' | 'neutral' | 'cool';
  recommendedAspectRatio: string;
  recommendedSceneComplexity: 'minimal' | 'moderate' | 'rich';
  occlusionTolerance: 'none' | 'low';
  humanPresencePolicy: 'forbidden' | 'optional' | 'required';
  petPresencePolicy: 'forbidden' | 'optional' | 'required';
  styleDirection: string[];
  avoidElements: string[];
  fidelityFocus: string[];
  consistencyAnchors: string[];
  confidence: number;
}

export interface DirectionPlan {
  id: 'catalog' | 'lifestyle' | 'campaign';
  scene: string;
  composition: string;
  lighting: string;
  mood: string;
  negativeRules: string[];
}

export interface DirectionScore {
  id: 'catalog' | 'lifestyle' | 'campaign';
  productFidelity: number;
  structureAccuracy: number;
  detailConsistency: number;
  sceneSuitability: number;
  compositionQuality: number;
  photographicRealism: number;
  groundingRealism: number;
  total: number;
  hardFail: boolean;
  hardFailReason: string | null;
}

export interface ScoreReport {
  scores: DirectionScore[];
  winnerId: 'catalog' | 'lifestyle' | 'campaign' | 'none';
  winnerReason: string;
  nextAction: 'final_refine' | 'rerun_scene_generation';
  needsRerun: boolean;
}

export interface CutoutQc {
  pass: boolean;
  checks: {
    structure: 'pass' | 'fail';
    material: 'pass' | 'fail';
    edgeQuality: 'pass' | 'fail';
    completeness: 'pass' | 'fail';
    backgroundCleanliness: 'pass' | 'fail';
  };
  failReason: string | null;
  retry: boolean;
}

export interface FinalQc {
  pass: boolean;
  checks: {
    structure: 'pass' | 'fail';
    proportion: 'pass' | 'fail';
    material: 'pass' | 'fail';
    details: 'pass' | 'fail';
    color: 'pass' | 'fail';
    shadow: 'pass' | 'fail';
    grounding: 'pass' | 'fail';
    photographicRealism: 'pass' | 'fail';
    backgroundCleanliness: 'pass' | 'fail';
    extraObjects: 'pass' | 'fail';
    textOrWatermark: 'pass' | 'fail';
  };
  failReason: string | null;
  retryStage: 'scene_generation' | 'final_refine' | 'none';
}


export type ResearchReportStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ResearchReportRecord extends Record<string, unknown> {
  id?: string;
  platform: string;
  query: string;
  instruction?: string | null;
  status: ResearchReportStatus;
  stage?: string | null;
  progress?: number | null;
  sources?: string | null;
  source_results?: string | null;
  summary?: string | null;
  report_path?: string | null;
  word_count?: number | null;
  error?: string | null;
  failure_stage?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
}

