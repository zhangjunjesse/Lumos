// Etsy 选品采集 — 前端 API client。纯爬取，无任何图片生成调用。

export type TaskSchedule = 'manual' | 'hourly' | 'daily' | 'weekly';
export type TaskStatus = 'idle' | 'running' | 'success' | 'failed' | 'partial' | 'cancelled';
export type ProductEhuntStatus = 'ok' | 'no_ehunt' | 'not_adspower' | 'bridge_unavailable' | 'failed';
export type DetailStatus = 'idle' | 'running' | 'success' | 'failed';

export interface KeywordTask {
  id: string;
  keyword: string;
  source: 'etsy';
  enabled: boolean;
  schedule: TaskSchedule;
  max_products: number;
  min_sales?: number;
  min_favorites?: number;
  min_price?: number;
  max_price?: number;
  max_pages?: number;
  total_collected: number;
  last_run_at?: string;
  last_status: TaskStatus;
  last_failure_reason?: string;
  last_collected_count: number;
}

export interface ProductEhunt {
  salesTotal: number | null;
  salesRecent: number | null;
  favorites: number | null;
  listedDate: string | null;
  raw: string;
}

export interface Product {
  id: string;
  listing_id: string;
  run_id?: string;
  run_at?: string;
  keyword: string;
  title: string;
  url: string;
  main_image_url: string;
  price?: string;
  rating?: string;
  reviews?: string;
  ehunt_status: ProductEhuntStatus;
  ehunt: ProductEhunt | null;
  selected: boolean;
  detail_status: DetailStatus;
  detail_image_count: number;
  detail_failure_reason?: string;
  created_at: string;
}

export interface LibImage {
  id: string;
  url: string;
  path: string | null; // 本地路径，加入创作助手作附件用（没下载到本地则为 null）
  is_main: boolean;
  position: number;
  created_at: string;
}

// 图库按商品维度：一个商品一组，附商品信息 + 该商品的详情图。
export interface LibProduct {
  product_id: string;
  listing_id: string;
  keyword: string;
  title: string;
  url: string;
  price?: string;
  rating?: string;
  reviews?: string;
  sales: number | null;
  sales_recent: number | null;
  favorites: number | null;
  listed_date: string | null;
  ehunt_status?: string;
  tags: string[];
  review_count: number;
  analyzed: boolean;
  cutout_status: string;
  cutout_count: number;
  asset_status: string;
  pose_status: string;
  latest_at: string;
  images: LibImage[];
}

export interface AssetItem {
  id: string;
  // design=印花(来自抠印花结果,只读展示,删除/重抠在图库「查看抠图」)
  category: 'scene' | 'model' | 'product' | 'pose' | 'design';
  description: string;
  url: string | null;
  path: string | null; // 本地绝对路径，创作区选作参考图时派发给 ChatView 附件用
  status: 'success' | 'failed';
  failure_reason: string | null;
  source_product_id: string | null;
  source_product_title: string | null;
  source_image_urls: string[];
}

export interface PromptItem {
  id: string;
  category: string;
  name: string;
  content: string;
  is_default: boolean;
}

export interface Cutout {
  id: string;
  source_count: number;
  cutout_url: string | null;
  status: 'success' | 'failed';
  failure_reason: string | null;
}

export interface AiProviderOption {
  id: string;
  name: string;
  isDefault: boolean;
  models: { value: string; label: string }[];
}

export interface Review {
  id: string;
  author: string | null;
  rating: string | null;
  date: string | null;
  region: string | null;
  text: string;
}

export interface ReviewTopic {
  topic: string;
  reason: string;
}

export interface ReviewAnalysis {
  reviewsAnalyzed: number;
  customerProfile: {
    genderMalePct: number;
    genderFemalePct: number;
    who: string;
    when: string;
    where: string;
    what: string;
  };
  pros: ReviewTopic[];
  cons: ReviewTopic[];
  expectations: ReviewTopic[];
  motivations: ReviewTopic[];
}

export interface RunItem {
  id: string;
  kind: 'list_collect' | 'detail_collect' | 'self_check';
  keyword?: string;
  products_found: number;
  ehunt_ok_count: number;
  images_collected: number;
  status: string;
  failure_reason?: string;
  started_at: string;
  ended_at?: string;
}

export interface RunListResult {
  runId: string;
  productsFound: number;
  inserted: number;
  ehuntStatus: string;
  ehuntHitCount: number;
  warning?: string;
}

export interface RunDetailResult {
  runId: string;
  okProducts: number;
  failProducts: number;
  totalImages: number;
  error?: string;
}

export interface PreviewResult {
  products: Array<{
    listingId: string;
    title: string;
    url: string;
    mainImageUrl: string;
    price: string | null;
    rating: string | null;
    reviews: string | null;
    ehunt: ProductEhunt | null;
  }>;
  ehuntStatus: ProductEhuntStatus;
  ehuntHitCount: number;
  searchUrl: string;
  warning?: string;
  browserContextId: string;
  hint: string;
}

const BASE = '/api/apps/builtin/etsy-forge';

async function jf<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const etsyForgeApi = {
  // 试爬验证
  collectPreview: (keyword: string, maxProducts?: number) =>
    jf<PreviewResult>(`${BASE}/collect-preview`, {
      method: 'POST',
      body: JSON.stringify({ keyword, maxProducts }),
    }),

  // 采集任务
  listTasks: () => jf<{ tasks: KeywordTask[] }>(`${BASE}/tasks`),
  createTask: (
    keyword: string,
    opts: {
      schedule?: TaskSchedule;
      maxProducts?: number;
      minSales?: number;
      minFavorites?: number;
      minPrice?: number;
      maxPrice?: number;
      maxPages?: number;
    } = {},
  ) =>
    jf<{ task: KeywordTask }>(`${BASE}/tasks`, {
      method: 'POST',
      body: JSON.stringify({
        keyword,
        schedule: opts.schedule,
        max_products: opts.maxProducts,
        min_sales: opts.minSales,
        min_favorites: opts.minFavorites,
        min_price: opts.minPrice,
        max_price: opts.maxPrice,
        max_pages: opts.maxPages,
      }),
    }),
  updateTask: (
    id: string,
    patch: {
      enabled?: boolean;
      schedule?: TaskSchedule;
      max_products?: number;
      min_sales?: number;
      min_favorites?: number;
      min_price?: number;
      max_price?: number;
      max_pages?: number;
    },
  ) =>
    jf<{ task: KeywordTask }>(`${BASE}/tasks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  deleteTask: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runTaskNow: (id: string, maxProducts?: number) =>
    jf<RunListResult>(`${BASE}/tasks/${encodeURIComponent(id)}/run-now`, {
      method: 'POST',
      body: JSON.stringify({ max_products: maxProducts }),
    }),

  // 商品列表
  listProducts: (opts: { keyword?: string; onlySelected?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (opts.keyword) p.set('keyword', opts.keyword);
    if (opts.onlySelected) p.set('selected', '1');
    return jf<{ total: number; products: Product[] }>(`${BASE}/products?${p.toString()}`);
  },
  setSelected: (ids: string[], selected: boolean) =>
    jf<{ ok: boolean; updated: number }>(`${BASE}/products`, {
      method: 'PATCH',
      body: JSON.stringify({ ids, selected }),
    }),
  collectDetails: (productIds?: string[]) =>
    jf<RunDetailResult>(`${BASE}/products/collect-details`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: productIds ?? [] }),
    }),

  // 图库（按商品维度聚合）
  listLibrary: (opts: { keyword?: string; productId?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.keyword) p.set('keyword', opts.keyword);
    if (opts.productId) p.set('product_id', opts.productId);
    return jf<{ total: number; productCount: number; products: LibProduct[]; allTags: string[] }>(
      `${BASE}/library?${p.toString()}`,
    );
  },
  // 给图库商品批量加/去标签
  applyProductTags: (productIds: string[], opts: { add?: string[]; remove?: string[] }) =>
    jf<{ ok: boolean; updated: number }>(`${BASE}/library/tags`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: productIds, add: opts.add, remove: opts.remove }),
    }),
  // 批量删除：商品（连带其图）/ 单张图
  deleteLibrary: (opts: { productIds?: string[]; imageIds?: string[] }) =>
    jf<{ ok: boolean; deletedProducts: number; deletedImages: number }>(`${BASE}/library/delete`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: opts.productIds, image_ids: opts.imageIds }),
    }),
  // 评论：列出某商品评论 + 缓存分析
  listReviews: (productId: string) =>
    jf<{
      productId: string;
      title: string;
      reviews: Review[];
      analysis: ReviewAnalysis | null;
      analyzedAt: string | null;
    }>(`${BASE}/library/reviews?product_id=${encodeURIComponent(productId)}`),
  // 跑 AI 评论分析（结果缓存到商品）
  analyzeReviews: (productId: string) =>
    jf<{ ok: boolean; analysis: ReviewAnalysis }>(`${BASE}/library/reviews/analyze`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId }),
    }),
  // 重新抓取某商品评论（走后台浏览器重开商品页抓，只更新评论不动详情图）
  recollectReviews: (productId: string) =>
    jf<{ ok: boolean; count: number }>(`${BASE}/library/reviews/recollect`, {
      method: 'POST',
      body: JSON.stringify({ product_id: productId }),
    }),
  // 抠图：对选中商品的图去背景。image_ids 指定时只抠选中的，否则抠商品所有图。
  startCutout: (opts: { productIds: string[]; imageIds?: string[]; prompt?: string }) =>
    jf<{ ok: boolean; okProducts: number; failProducts: number }>(`${BASE}/library/cutout`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: opts.productIds, image_ids: opts.imageIds, prompt: opts.prompt }),
    }),
  // 列某商品抠图结果
  listCutouts: (productId: string) =>
    jf<{ productId: string; title: string; cutouts: Cutout[] }>(
      `${BASE}/library/cutouts?product_id=${encodeURIComponent(productId)}`,
    ),
  // 提示词库（5 分类：cutout/scene/model/product/pose）。default_content=该类内置默认。
  listPrompts: (category = 'cutout') =>
    jf<{ prompts: PromptItem[]; default_content: string }>(`${BASE}/prompts?category=${encodeURIComponent(category)}`),
  createPrompt: (p: { category?: string; name: string; content: string; is_default?: boolean }) =>
    jf<{ ok: boolean; id: string }>(`${BASE}/prompts`, { method: 'POST', body: JSON.stringify(p) }),
  // 改内容 / 设为生效（is_default=true 会取消同类其它生效项）
  updatePrompt: (p: { id: string; content?: string; is_default?: boolean }) =>
    jf<{ ok: boolean }>(`${BASE}/prompts`, { method: 'PATCH', body: JSON.stringify(p) }),
  deletePrompt: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/prompts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  // 素材库：批量分析（异步，立即返回 started 数；后台跑，前端轮询 asset_status 看进度）
  analyzeAssets: (productIds: string[], imageIds?: string[]) =>
    jf<{ ok: boolean; started: number }>(`${BASE}/assets/analyze`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: productIds, image_ids: imageIds }),
    }),
  // 抠模特姿势（异步）：选含模特的图，逐张抠出真实模特→存「模特姿势」类，前端轮询 pose_status。
  extractPose: (productIds: string[], imageIds?: string[]) =>
    jf<{ ok: boolean; started: number }>(`${BASE}/assets/extract-pose`, {
      method: 'POST',
      body: JSON.stringify({ product_ids: productIds, image_ids: imageIds }),
    }),
  listAssets: (category?: string) =>
    jf<{ assets: AssetItem[] }>(`${BASE}/assets${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  deleteAsset: (id: string) =>
    jf<{ ok: boolean }>(`${BASE}/assets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // 运行结果 / 设置 / 危险
  listRuns: (kind?: string) => jf<{ runs: RunItem[] }>(`${BASE}/runs${kind ? `?kind=${kind}` : ''}`),
  getSettings: () =>
    jf<{
      browser_context_id: string;
      default_max_products?: number;
      download_detail_images?: boolean;
      ai_provider_id?: string;
      ai_model?: string;
      ai_providers?: AiProviderOption[];
      ai_locked?: boolean;
    }>(`${BASE}/settings`),
  updateSettings: (patch: {
    browser_context_id?: string;
    ai_provider_id?: string;
    ai_model?: string;
  }) =>
    jf<{ ok: boolean }>(`${BASE}/settings`, { method: 'PUT', body: JSON.stringify(patch) }),
  danger: (action: 'clear-library' | 'clear-products') =>
    jf<{ ok: boolean; affected?: number }>(`${BASE}/danger`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
};
