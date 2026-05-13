import type { AppDataStore } from '@/lib/app/runtime/data-store';
import type {
  DiscoverCandidateRecord,
  ImageJobRecord,
  ImageOutputRecord,
  ListingDraftRecord,
  ProductBriefRecord,
  ProductInputRecord,
} from './types';

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

interface BuildOpts {
  limit?: number;
}

export function buildPipeline(store: AppDataStore, opts: BuildOpts = {}): PipelineEntry[] {
  const limit = opts.limit ?? 50;
  const inputs = store.query<ProductInputRecord>('product_inputs', {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit,
  });
  if (inputs.length === 0) return [];

  const inputIds = new Set(inputs.map((i) => i.id));
  const candidates = store.query<DiscoverCandidateRecord>('discover_candidates', {
    filter: { status: 'promoted' },
    limit: 500,
  });
  const candidateByInputId = new Map<string, DiscoverCandidateRecord>();
  for (const c of candidates) {
    if (c.promoted_input_id && inputIds.has(c.promoted_input_id)) {
      candidateByInputId.set(c.promoted_input_id, c);
    }
  }

  const briefs = store.query<ProductBriefRecord>('product_briefs', { limit: 1000 });
  const briefByInputId = new Map<string, ProductBriefRecord>();
  for (const b of briefs) {
    if (inputIds.has(b.input_id)) briefByInputId.set(b.input_id, b);
  }

  const jobs = store.query<ImageJobRecord>('image_jobs', { limit: 2000 });
  const jobsByInputId = new Map<string, ImageJobRecord[]>();
  for (const j of jobs) {
    if (!inputIds.has(j.input_id)) continue;
    const arr = jobsByInputId.get(j.input_id) ?? [];
    arr.push(j);
    jobsByInputId.set(j.input_id, arr);
  }

  const winners = store.query<ImageOutputRecord>('image_outputs', {
    filter: { is_winner: true },
    limit: 2000,
  });
  const winnerByInputId = new Map<string, ImageOutputRecord>();
  for (const w of winners) {
    if (w.input_id && inputIds.has(w.input_id)) winnerByInputId.set(w.input_id, w);
  }

  const drafts = store.query<ListingDraftRecord>('listing_drafts', { limit: 2000 });
  const draftsByInputId = new Map<string, ListingDraftRecord[]>();
  for (const d of drafts) {
    if (!inputIds.has(d.input_id)) continue;
    const arr = draftsByInputId.get(d.input_id) ?? [];
    arr.push(d);
    draftsByInputId.set(d.input_id, arr);
  }

  return inputs.map((input) => buildEntry(input, {
    candidate: candidateByInputId.get(input.id) ?? null,
    brief: briefByInputId.get(input.id) ?? null,
    jobs: jobsByInputId.get(input.id) ?? [],
    winner: winnerByInputId.get(input.id) ?? null,
    drafts: draftsByInputId.get(input.id) ?? [],
  }));
}

interface BuildEntryDeps {
  candidate: DiscoverCandidateRecord | null;
  brief: ProductBriefRecord | null;
  jobs: ImageJobRecord[];
  winner: ImageOutputRecord | null;
  drafts: ListingDraftRecord[];
}

function buildEntry(input: ProductInputRecord, deps: BuildEntryDeps): PipelineEntry {
  const mainImagePath = input.main_image_path?.trim() ?? '';
  const conceptImagePath = deps.candidate?.concept_image_path?.trim() ?? '';
  const hasMainImage = mainImagePath.length > 0 && (!conceptImagePath || mainImagePath !== conceptImagePath);
  const jobsSorted = [...deps.jobs].sort((a, b) => {
    const at = a.updated_at ?? '';
    const bt = b.updated_at ?? '';
    return bt.localeCompare(at);
  });
  const lastJob = jobsSorted[0] ?? null;
  const running = deps.jobs.filter((j) =>
    !['completed', 'failed', 'cancelled'].includes(j.status),
  ).length;
  const succeeded = deps.jobs.filter((j) => j.status === 'completed').length;
  const failed = deps.jobs.filter((j) => j.status === 'failed').length;

  const byPlatform: Record<string, number> = {};
  let listingsReady = 0;
  let listingsFailed = 0;
  let listingsSubmitted = 0;
  let listingsLive = 0;
  let listingsRejected = 0;
  let hasWarnings = false;
  for (const d of deps.drafts) {
    byPlatform[d.platform] = (byPlatform[d.platform] ?? 0) + 1;
    if (d.status === 'ready') listingsReady++;
    if (d.status === 'failed') listingsFailed++;
    if (d.status === 'submitted') listingsSubmitted++;
    if (d.status === 'live') listingsLive++;
    if (d.status === 'rejected') listingsRejected++;
    if (d.warnings) {
      try {
        const w = JSON.parse(d.warnings);
        if (Array.isArray(w) && w.length > 0) hasWarnings = true;
      } catch {
        /* ignore */
      }
    }
  }

  const finalImagePath = deps.winner?.image_path ?? lastJob?.final_image_path ?? null;
  const stage = computeStage({
    hasMainImage,
    runningJobs: running,
    failedJobs: failed,
    succeededJobs: succeeded,
    finalImagePath,
    listingsReady,
    hasWarnings,
  });

  return {
    inputId: input.id ?? '',
    title: input.title,
    categoryHint: input.category_hint ?? null,
    source: deps.candidate ? 'discover-promoted' : 'manual',
    candidateId: deps.candidate?.id ?? null,
    conceptImagePath: conceptImagePath || null,
    mainImagePath,
    hasMainImage,
    brief: {
      hasBrief: !!deps.brief,
      productType: deps.brief?.product_type ?? null,
      confidence: deps.brief?.confidence ?? null,
    },
    jobs: {
      total: deps.jobs.length,
      running,
      succeeded,
      failed,
      lastStatus: lastJob?.status ?? null,
      lastUpdatedAt: lastJob?.updated_at ?? null,
    },
    finalImagePath,
    listings: {
      total: deps.drafts.length,
      ready: listingsReady,
      failed: listingsFailed,
      submitted: listingsSubmitted,
      live: listingsLive,
      rejected: listingsRejected,
      byPlatform,
      hasWarnings,
    },
    stage,
    nextStep: nextStepFor(stage),
    updatedAt: input.updated_at ?? null,
  };
}

interface StageInput {
  hasMainImage: boolean;
  runningJobs: number;
  failedJobs: number;
  succeededJobs: number;
  finalImagePath: string | null;
  listingsReady: number;
  hasWarnings: boolean;
}

function computeStage(s: StageInput): PipelineStage {
  if (!s.hasMainImage) return 'needs-main-image';
  if (s.runningJobs > 0) return 'generating';
  if (s.failedJobs > 0 && s.succeededJobs === 0 && !s.finalImagePath) return 'image-failed';
  // Listings outrank "no image yet" because once a draft exists the user is
  // already in copy-to-platform territory.
  if (s.listingsReady > 0 && s.hasWarnings) return 'has-warnings';
  if (s.listingsReady > 0 && s.finalImagePath) return 'live-ready';
  if (s.listingsReady > 0) return 'listings-drafted';
  if (s.finalImagePath) return 'has-final-image';
  return 'ready-to-generate';
}

function nextStepFor(stage: PipelineStage): string {
  switch (stage) {
    case 'needs-main-image':
      return '上传真实样品主图；AI 概念图只作参考，不能启动出图 SOP';
    case 'ready-to-generate':
      return '在工坊点「基于此输入出图」启动 SOP';
    case 'generating':
      return '出图任务运行中，去任务页看进度';
    case 'image-failed':
      return '出图失败，去任务页看失败原因，或重新运行';
    case 'has-final-image':
      return '出图已完成，去上架 Tab 起草 listing';
    case 'listings-drafted':
      return '已起草 listing，复制到平台后台手工提交';
    case 'has-warnings':
      return '草稿含合规警示，必读后再提交到平台';
    case 'live-ready':
      return '完整链路就绪，复制 listing → 平台后台 → 上架';
    default:
      return '继续下一步';
  }
}
