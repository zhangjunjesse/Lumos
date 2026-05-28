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
  keyword: string;
  title: string;
  url: string;
  main_image_url: string;
  price?: string;
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
  product_id: string;
  listing_id: string;
  keyword: string;
  url: string;
  is_main: boolean;
  position: number;
  created_at: string;
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
  createTask: (keyword: string, schedule?: TaskSchedule, maxProducts?: number) =>
    jf<{ task: KeywordTask }>(`${BASE}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ keyword, schedule, max_products: maxProducts }),
    }),
  updateTask: (id: string, patch: { enabled?: boolean; schedule?: TaskSchedule; max_products?: number }) =>
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

  // 图库（详情图）
  listLibrary: (opts: { keyword?: string; productId?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.keyword) p.set('keyword', opts.keyword);
    if (opts.productId) p.set('product_id', opts.productId);
    return jf<{ total: number; images: LibImage[] }>(`${BASE}/library?${p.toString()}`);
  },

  // 运行结果 / 设置 / 危险
  listRuns: (kind?: string) => jf<{ runs: RunItem[] }>(`${BASE}/runs${kind ? `?kind=${kind}` : ''}`),
  getSettings: () =>
    jf<{ browser_context_id: string; default_max_products?: number; download_detail_images?: boolean }>(
      `${BASE}/settings`,
    ),
  updateSettings: (patch: { browser_context_id?: string }) =>
    jf<{ ok: boolean }>(`${BASE}/settings`, { method: 'PUT', body: JSON.stringify(patch) }),
  danger: (action: 'clear-library' | 'clear-products') =>
    jf<{ ok: boolean; affected?: number }>(`${BASE}/danger`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
};
