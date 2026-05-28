// Etsy 选品采集 — 共享类型。data-schema.json 是真源，这里是 TS 视角窄类型。
// 产品逻辑：关键词爬 Etsy 列表(主图+EHunt) → 勾选 → 爬详情图入图库。全程爬取不调图片服务商。

export type TaskSchedule = 'manual' | 'hourly' | 'daily' | 'weekly';
export type TaskStatus = 'idle' | 'running' | 'success' | 'failed' | 'partial' | 'cancelled';
export type ProductEhuntStatus = 'ok' | 'no_ehunt' | 'not_adspower' | 'bridge_unavailable' | 'failed';
export type DetailStatus = 'idle' | 'running' | 'success' | 'failed';
export type RunKind = 'list_collect' | 'detail_collect' | 'self_check';
export type RunStatus = 'running' | 'success' | 'failed' | 'cancelled' | 'partial';

export interface KeywordTaskRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  keyword: string;
  source: 'etsy';
  enabled: boolean;
  schedule: TaskSchedule;
  max_products: number;
  total_collected: number;
  last_run_id?: string;
  last_run_at?: string;
  last_status: TaskStatus;
  last_failure_reason?: string;
  last_collected_count: number;
  next_run_at?: string;
  created_at: string;
}

export interface EhuntMetricsJson {
  salesTotal: number | null;
  salesRecent: number | null;
  favorites: number | null;
  listedDate: string | null;
  raw: string;
}

export interface ProductRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  task_id?: string;
  keyword: string;
  source: 'etsy';
  listing_id: string;
  title: string;
  url: string;
  main_image_url: string;
  price?: string;
  rating?: string;
  reviews?: string;
  sales?: string;
  ehunt_json?: string;
  ehunt_status: ProductEhuntStatus;
  selected: boolean;
  detail_status: DetailStatus;
  detail_image_count: number;
  detail_failure_reason?: string;
  created_at: string;
}

export interface DetailImageRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  product_id: string;
  listing_id: string;
  keyword: string;
  image_url: string;
  local_path?: string;
  is_main: boolean;
  position: number;
  created_at: string;
}

export interface RunRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  kind: RunKind;
  keyword?: string;
  products_found: number;
  ehunt_ok_count: number;
  images_collected: number;
  status: RunStatus;
  failure_reason?: string;
  started_at: string;
  ended_at?: string;
}

export interface AppSettings extends Record<string, unknown> {
  browser_context_id: string;
  default_max_products: number;
  download_detail_images: boolean;
  ai_system_prompt: string;
  risk_note: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  browser_context_id: 'embedded:default',
  default_max_products: 24,
  download_detail_images: false,
  ai_system_prompt:
    '本应用是纯爬取选品工具，不生成图片、不调图片服务商。采集到的同行商品图仅作选品研究参考。',
  risk_note:
    '采集图仅选品参考，不可直接上架售卖（DMCA 侵权）；不绕过 Etsy 反爬；EHunt 指标依赖 AdsPower + EHunt 扩展，抓不到如实显示不 mock。',
};

export const COLLECTIONS = {
  TASKS: 'etsy_forge_collection_tasks',
  PRODUCTS: 'etsy_forge_products',
  IMAGES: 'etsy_forge_images',
  RUNS: 'etsy_forge_runs',
  APP_SETTINGS: 'app_settings',
  RUN_HISTORY: 'run_history',
} as const;
