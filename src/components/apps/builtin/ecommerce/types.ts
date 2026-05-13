export interface EcommerceProviderCheck {
  ok: boolean;
  name?: string;
  reason?: string;
}

export interface EcommerceAssistantStatus {
  app: { id: string; name: string; version: string; source: string; status: string };
  install: { installed: boolean; version: string | null; error: string | null };
  providers: { analysis: EcommerceProviderCheck; image: EcommerceProviderCheck };
  inventory: {
    ready: boolean;
    inputCount: number;
    runningJobs: number;
    storeError: string | null;
  };
  lastJob: {
    id: string;
    status: string;
    stage: string | null;
    progress: number | null;
    updatedAt: string | null;
    failureReason: string | null;
  } | null;
  ready: boolean;
  phase: string;
}

export interface ProductInput {
  id: string;
  title: string;
  category_hint?: string | null;
  main_image_path: string;
  reference_image_paths?: string | null;
  note?: string | null;
  status: 'ready' | 'archived';
  updated_at?: string | null;
  created_at?: string | null;
}

export interface ImageJob {
  id: string;
  input_id: string;
  preset_id?: string | null;
  aspect_ratio?: string | null;
  status: string;
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
  updated_at?: string | null;
  created_at?: string | null;
}

export interface ImageOutput {
  id: string;
  job_id: string;
  kind:
    | 'cutout'
    | 'catalog'
    | 'lifestyle'
    | 'campaign'
    | 'final'
    | 'fallback'
    | 'detail-hero'
    | 'detail-feature'
    | 'detail-lifestyle'
    | 'detail-scale';
  iteration?: number | null;
  image_path: string;
  qc_pass?: boolean | null;
  qc_summary?: string | null;
  qc_fail_reason?: string | null;
  is_winner?: boolean | null;
  prompt?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface DiscoverReferenceUrl {
  platform: string;
  url: string;
  label?: string;
}

export interface DiscoverCandidate {
  id: string;
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
  status: 'researching' | 'ready' | 'failed' | 'promoted';
  promoted_input_id?: string | null;
  failure_reason?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface StylePreset {
  id: string;
  name: string;
  direction: 'catalog' | 'lifestyle' | 'campaign' | 'custom';
  scene?: string | null;
  composition?: string | null;
  lighting?: string | null;
  mood?: string | null;
  negative_rules?: string | null;
  is_builtin?: boolean | null;
  enabled?: boolean | null;
}

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

export interface ListingDraft {
  id: string;
  input_id: string;
  platform: ListingPlatform;
  language: string;
  title?: string | null;
  bullets?: string | null;
  description?: string | null;
  search_keywords?: string | null;
  warnings?: string | null;
  status:
    | 'drafting'
    | 'ready'
    | 'failed'
    | 'archived'
    | 'submitted'
    | 'live'
    | 'rejected';
  failure_reason?: string | null;
  submitted_at?: string | null;
  live_at?: string | null;
  live_url?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  user_notes?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export type PipelineStage =
  | 'needs-main-image'
  | 'ready-to-generate'
  | 'generating'
  | 'image-failed'
  | 'has-final-image'
  | 'listings-drafted'
  | 'has-warnings'
  | 'live-ready';

export interface PipelineEntry {
  inputId: string;
  title: string;
  categoryHint: string | null;
  source: 'manual' | 'discover-promoted';
  candidateId: string | null;
  conceptImagePath: string | null;
  mainImagePath: string;
  hasMainImage: boolean;
  brief: { hasBrief: boolean; productType: string | null; confidence: number | null };
  jobs: {
    total: number;
    running: number;
    succeeded: number;
    failed: number;
    lastStatus: string | null;
    lastUpdatedAt: string | null;
  };
  finalImagePath: string | null;
  listings: {
    total: number;
    ready: number;
    failed: number;
    submitted: number;
    live: number;
    rejected: number;
    byPlatform: Record<string, number>;
    hasWarnings: boolean;
  };
  stage: PipelineStage;
  nextStep: string;
  updatedAt: string | null;
}

export type EcommerceTab =
  | 'overview'
  | 'research'
  | 'discover'
  | 'studio'
  | 'jobs'
  | 'listings'
  | 'library'
  | 'presets'
  | 'settings';

export type ResearchReportStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ResearchReport {
  id: string;
  platform: string;
  query: string;
  instruction: string | null;
  status: ResearchReportStatus;
  stage: string | null;
  progress: number | null;
  sources: string[];
  source_results: string | null;
  summary: string | null;
  report_path: string | null;
  word_count: number | null;
  error: string | null;
  failure_stage: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

export interface DashboardCounts {
  candidates: { total: number; ready: number; promoted: number; failed: number };
  products: { total: number; needsMain: number; hasFinal: number };
  jobs: { total: number; running: number; completed: number; failed: number };
  listings: {
    total: number;
    ready: number;
    submitted: number;
    live: number;
    rejected: number;
  };
}

export interface DashboardActivity {
  kind: 'candidate' | 'product' | 'job' | 'listing';
  id: string;
  title: string;
  detail: string;
  at: string;
}

export interface DashboardTodo {
  id: string;
  priority: 'high' | 'medium' | 'low';
  text: string;
  jumpTo: 'discover' | 'studio' | 'jobs' | 'listings';
  count: number;
}

export interface DashboardWinner {
  inputId: string;
  productTitle: string;
  imagePath: string;
  updatedAt: string | null;
}

export interface DashboardLive {
  draftId: string;
  inputId: string;
  productTitle: string;
  platform: string;
  liveUrl: string | null;
  liveAt: string | null;
}

export type OnboardingStepId =
  | 'configure-provider'
  | 'first-research'
  | 'first-product'
  | 'first-image-job'
  | 'first-listing'
  | 'first-live';

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
  done: boolean;
  jumpTo: 'overview' | 'discover' | 'studio' | 'jobs' | 'listings';
}

export interface OnboardingState {
  steps: OnboardingStep[];
  doneCount: number;
  totalCount: number;
  complete: boolean;
  nextStep: OnboardingStep | null;
}

export interface ListingFollowup {
  id: string;
  draft_id: string;
  input_id: string;
  template_id: string;
  title: string;
  description?: string | null;
  due_at: string;
  status: 'pending' | 'done' | 'skipped';
  done_at?: string | null;
  note?: string | null;
}

export interface DashboardSnapshot {
  counts: DashboardCounts;
  recentActivity: DashboardActivity[];
  todos: DashboardTodo[];
  recentFinalImages: DashboardWinner[];
  liveListings: DashboardLive[];
  onboarding: OnboardingState;
  generatedAt: string;
}
