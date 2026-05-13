import type { AppDataStore } from '@/lib/app/runtime/data-store';
import type {
  DiscoverCandidateRecord,
  ImageJobRecord,
  ListingDraftRecord,
  ProductInputRecord,
} from './types';

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
  /** When all steps are done, callers can hide the card. */
  complete: boolean;
  /** The first not-done step the user should focus on next. */
  nextStep: OnboardingStep | null;
}

interface ProviderHints {
  hasImageProvider: boolean;
  hasAnalysisProvider: boolean;
}

/**
 * Compute the user's onboarding progress against a 5-step happy path:
 *   1. configure provider
 *   2. run first discover research (any candidate exists)
 *   3. create first product (any input exists)
 *   4. complete first image SOP job
 *   5. draft first listing
 *   6. mark first listing live (optional bonus)
 *
 * Steps are computed from existing collection state; no separate "tutorial
 * progress" record is needed (avoids drift if data is later imported).
 */
export function computeOnboarding(
  store: AppDataStore,
  providers: ProviderHints,
): OnboardingState {
  const candidates = store.query<DiscoverCandidateRecord>('discover_candidates', { limit: 1 });
  const inputs = store.query<ProductInputRecord>('product_inputs', { limit: 1 });
  const completedJobs = store.query<ImageJobRecord>('image_jobs', {
    filter: { status: 'completed' },
    limit: 1,
  });
  const drafts = store.query<ListingDraftRecord>('listing_drafts', { limit: 1 });
  const liveListings = store.query<ListingDraftRecord>('listing_drafts', {
    filter: { status: 'live' },
    limit: 1,
  });

  const steps: OnboardingStep[] = [
    {
      id: 'configure-provider',
      title: '配置 AI 服务商',
      description: '设置 LLM 用于评分 / 文案，图像服务商用于出图 SOP。在「设置 → 服务商」配置。',
      done: providers.hasAnalysisProvider && providers.hasImageProvider,
      jumpTo: 'overview',
    },
    {
      id: 'first-research',
      title: '跑第一次选品研究',
      description: '在「选品」Tab 输入关键词与目标平台，AI 出 8 个候选，附真实联网样品 + 5 维评分。',
      done: candidates.length > 0,
      jumpTo: 'discover',
    },
    {
      id: 'first-product',
      title: '建立第一个产品',
      description: '从候选转入工坊（自动建产品 + 合成 brief），或在工坊手工录入。',
      done: inputs.length > 0,
      jumpTo: 'studio',
    },
    {
      id: 'first-image-job',
      title: '完成第一次出图 SOP',
      description: '上传真实样品图后启动出图，AI 自动跑 12 步：识别 → 抠图 → 3 方向 → 评分 → 终版精修。',
      done: completedJobs.length > 0,
      jumpTo: 'jobs',
    },
    {
      id: 'first-listing',
      title: '起第一条 listing 草稿',
      description: '在「上架」Tab 选商品 + 平台 + 语言，AI 按平台 cap 起 title / bullets / 描述 / 后台关键词。',
      done: drafts.length > 0,
      jumpTo: 'listings',
    },
    {
      id: 'first-live',
      title: '上架第一条 listing',
      description: '复制草稿到平台后台手工提交，回应用标记「已提交」/「已上线」。',
      done: liveListings.length > 0,
      jumpTo: 'listings',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const totalCount = steps.length;
  const nextStep = steps.find((s) => !s.done) ?? null;

  return {
    steps,
    doneCount,
    totalCount,
    complete: doneCount === totalCount,
    nextStep,
  };
}
