import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { computeOnboarding, type OnboardingState } from './onboarding';
import type {
  DiscoverCandidateRecord,
  ImageJobRecord,
  ImageOutputRecord,
  ListingDraftRecord,
  ListingFollowupRecord,
  ProductBriefRecord,
  ProductInputRecord,
} from './types';

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

export interface DashboardSnapshot {
  counts: DashboardCounts;
  recentActivity: DashboardActivity[];
  todos: DashboardTodo[];
  recentFinalImages: DashboardWinner[];
  liveListings: DashboardLive[];
  onboarding: OnboardingState;
  generatedAt: string;
}

export interface DashboardBuildOpts {
  hasImageProvider?: boolean;
  hasAnalysisProvider?: boolean;
}

export function buildDashboard(
  store: AppDataStore,
  opts: DashboardBuildOpts = {},
): DashboardSnapshot {
  const candidates = store.query<DiscoverCandidateRecord>('discover_candidates', {
    limit: 1000,
  });
  const inputs = store.query<ProductInputRecord>('product_inputs', { limit: 1000 });
  const briefs = store.query<ProductBriefRecord>('product_briefs', { limit: 1000 });
  const jobs = store.query<ImageJobRecord>('image_jobs', { limit: 1000 });
  const winners = store.query<ImageOutputRecord>('image_outputs', {
    filter: { is_winner: true },
    limit: 500,
  });
  const drafts = store.query<ListingDraftRecord>('listing_drafts', { limit: 1000 });
  const followups = store.query<ListingFollowupRecord>('listing_followups', {
    filter: { status: 'pending' },
    limit: 500,
  });

  const inputById = new Map(inputs.map((i) => [i.id, i]));
  const winnerByInputId = new Map<string, ImageOutputRecord>();
  for (const w of winners) {
    if (w.input_id && !winnerByInputId.has(w.input_id)) winnerByInputId.set(w.input_id, w);
  }
  void briefs; // available if we ever need to surface brief state

  const counts: DashboardCounts = {
    candidates: {
      total: candidates.length,
      ready: candidates.filter((c) => c.status === 'ready').length,
      promoted: candidates.filter((c) => c.status === 'promoted').length,
      failed: candidates.filter((c) => c.status === 'failed').length,
    },
    products: {
      total: inputs.length,
      needsMain: inputs.filter(
        (i) => !i.main_image_path || !i.main_image_path.trim(),
      ).length,
      hasFinal: inputs.filter((i) => winnerByInputId.has(i.id)).length,
    },
    jobs: {
      total: jobs.length,
      running: jobs.filter((j) =>
        !['completed', 'failed', 'cancelled'].includes(j.status),
      ).length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
    },
    listings: {
      total: drafts.length,
      ready: drafts.filter((d) => d.status === 'ready').length,
      submitted: drafts.filter((d) => d.status === 'submitted').length,
      live: drafts.filter((d) => d.status === 'live').length,
      rejected: drafts.filter((d) => d.status === 'rejected').length,
    },
  };

  const recentActivity = buildRecentActivity({ candidates, inputs, jobs, drafts });
  const todos = buildTodos({ candidates, inputs, jobs, drafts, followups });
  const recentFinalImages = winners
    .slice(0, 8)
    .map<DashboardWinner | null>((w) => {
      if (!w.input_id) return null;
      const input = inputById.get(w.input_id);
      if (!input) return null;
      return {
        inputId: w.input_id,
        productTitle: input.title,
        imagePath: w.image_path,
        updatedAt: w.updated_at ?? null,
      };
    })
    .filter((x): x is DashboardWinner => x != null);

  const liveListings = drafts
    .filter((d) => d.status === 'live')
    .sort((a, b) => (b.live_at ?? '').localeCompare(a.live_at ?? ''))
    .slice(0, 8)
    .map<DashboardLive>((d) => ({
      draftId: d.id,
      inputId: d.input_id,
      productTitle: inputById.get(d.input_id)?.title ?? '(未知商品)',
      platform: d.platform,
      liveUrl: d.live_url ?? null,
      liveAt: d.live_at ?? null,
    }));

  const onboarding = computeOnboarding(store, {
    hasImageProvider: opts.hasImageProvider ?? false,
    hasAnalysisProvider: opts.hasAnalysisProvider ?? false,
  });

  return {
    counts,
    recentActivity,
    todos,
    recentFinalImages,
    liveListings,
    onboarding,
    generatedAt: new Date().toISOString(),
  };
}

interface ActivityInputs {
  candidates: DiscoverCandidateRecord[];
  inputs: ProductInputRecord[];
  jobs: ImageJobRecord[];
  drafts: ListingDraftRecord[];
  followups?: ListingFollowupRecord[];
}

function buildRecentActivity({
  candidates,
  inputs,
  jobs,
  drafts,
}: ActivityInputs): DashboardActivity[] {
  const events: DashboardActivity[] = [];
  for (const c of candidates) {
    events.push({
      kind: 'candidate',
      id: c.id ?? '',
      title: c.product_name,
      detail: `候选 ${c.status === 'promoted' ? '已转入' : c.status === 'failed' ? '失败' : '待 promote'}`,
      at: c.updated_at ?? c.created_at ?? '',
    });
  }
  for (const i of inputs) {
    events.push({
      kind: 'product',
      id: i.id ?? '',
      title: i.title,
      detail:
        !i.main_image_path || !i.main_image_path.trim() ? '产品（缺主图）' : '产品',
      at: i.updated_at ?? i.created_at ?? '',
    });
  }
  for (const j of jobs) {
    events.push({
      kind: 'job',
      id: j.id ?? '',
      title: `出图任务 (${j.stage ?? j.status})`,
      detail: `${j.status}${j.failure_reason ? ` · ${j.failure_reason.slice(0, 60)}` : ''}`,
      at: j.updated_at ?? j.created_at ?? '',
    });
  }
  for (const d of drafts) {
    events.push({
      kind: 'listing',
      id: d.id ?? '',
      title: `${d.platform} · ${d.title?.slice(0, 60) ?? '(未起草)'}`,
      detail: `Listing ${d.status}`,
      at: d.updated_at ?? d.created_at ?? '',
    });
  }
  return events
    .filter((e) => e.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 15);
}

function buildTodos({
  candidates,
  inputs,
  jobs,
  drafts,
  followups,
}: ActivityInputs): DashboardTodo[] {
  const todos: DashboardTodo[] = [];

  // overdue / today-due followups
  const now = new Date();
  const todayStr = now.toISOString();
  const dueOrOverdue = (followups ?? []).filter(
    (f) => f.status === 'pending' && (f.due_at ?? '') <= todayStr,
  );
  const overdueOnly = dueOrOverdue.filter((f) => {
    const due = new Date(f.due_at ?? '');
    return now.getTime() - due.getTime() > 24 * 60 * 60 * 1000;
  });
  if (dueOrOverdue.length > 0) {
    const overdueSuffix =
      overdueOnly.length > 0 ? `（含 ${overdueOnly.length} 项已逾期 1 天+）` : '';
    todos.push({
      id: 'followups-due',
      priority: overdueOnly.length > 0 ? 'high' : 'medium',
      text: `${dueOrOverdue.length} 条售后清单到期${overdueSuffix}，去 listing 卡片勾掉或跳过`,
      jumpTo: 'listings',
      count: dueOrOverdue.length,
    });
  }

  const readyCandidates = candidates.filter((c) => c.status === 'ready').length;
  if (readyCandidates > 0) {
    todos.push({
      id: 'promote-candidates',
      priority: 'medium',
      text: `${readyCandidates} 个选品候选待转入工坊`,
      jumpTo: 'discover',
      count: readyCandidates,
    });
  }

  const needsMain = inputs.filter(
    (i) => !i.main_image_path || !i.main_image_path.trim(),
  ).length;
  if (needsMain > 0) {
    todos.push({
      id: 'upload-main-image',
      priority: 'high',
      text: `${needsMain} 个产品缺主图（影响主链：必须先补图才能出图 SOP）`,
      jumpTo: 'studio',
      count: needsMain,
    });
  }

  const failedJobs = jobs.filter((j) => j.status === 'failed').length;
  if (failedJobs > 0) {
    todos.push({
      id: 'failed-jobs',
      priority: 'medium',
      text: `${failedJobs} 个出图任务失败，去看原因或重试`,
      jumpTo: 'jobs',
      count: failedJobs,
    });
  }

  const readyListings = drafts.filter((d) => d.status === 'ready').length;
  if (readyListings > 0) {
    todos.push({
      id: 'submit-listings',
      priority: 'medium',
      text: `${readyListings} 个 listing 起草完成，复制到平台后标记「已提交」`,
      jumpTo: 'listings',
      count: readyListings,
    });
  }

  const rejectedListings = drafts.filter((d) => d.status === 'rejected').length;
  if (rejectedListings > 0) {
    todos.push({
      id: 'fix-rejected',
      priority: 'high',
      text: `${rejectedListings} 个 listing 被平台拒绝，看原因后重起或申诉`,
      jumpTo: 'listings',
      count: rejectedListings,
    });
  }

  // suggest re-drafting listings whose underlying brief has been upgraded
  // to a real-photo identification — i.e. input now has a final image and
  // the listing was drafted before. Heuristic: listing.created_at < image_jobs.completed_at for that input.
  const finishedJobsByInput = new Map<string, string>();
  for (const j of jobs) {
    if (j.status === 'completed' && j.updated_at) {
      const cur = finishedJobsByInput.get(j.input_id) ?? '';
      if (j.updated_at > cur) finishedJobsByInput.set(j.input_id, j.updated_at);
    }
  }
  let staleDrafts = 0;
  for (const d of drafts) {
    if (d.status !== 'ready') continue;
    const completedAt = finishedJobsByInput.get(d.input_id);
    if (completedAt && d.created_at && completedAt > d.created_at) {
      staleDrafts++;
    }
  }
  if (staleDrafts > 0) {
    todos.push({
      id: 'redraft-listings',
      priority: 'low',
      text: `${staleDrafts} 个 listing 用的是出图前的 brief，建议重起草以采用更高 confidence 的真实 brief`,
      jumpTo: 'listings',
      count: staleDrafts,
    });
  }

  // sort: high → medium → low
  const order = { high: 0, medium: 1, low: 2 } as const;
  todos.sort((a, b) => order[a.priority] - order[b.priority]);
  return todos;
}
