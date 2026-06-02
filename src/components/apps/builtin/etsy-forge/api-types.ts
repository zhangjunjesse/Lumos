// Etsy 选品采集 — 前端 API client 类型定义(从 api-client.ts 拆出以满足单文件≤300行)。

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

// 详情图类型(②b AI 分类)：model_scene=商品图 / product=产品图 / size=尺码图 / color=颜色图 / other=其他
export type ImageType = 'model_scene' | 'product' | 'size' | 'color' | 'other';

export interface LibImage {
  id: string;
  url: string;
  path: string | null; // 本地路径，加入创作助手作附件用（没下载到本地则为 null）
  image_type: ImageType | null;
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
  // design=印花(来自抠印花结果,只读展示,删除/重抠在图库「查看抠图」);remix=印花二创变体(SOP⑤产出)
  category: 'scene' | 'model' | 'product' | 'pose' | 'design' | 'remix';
  description: string;
  url: string | null;
  path: string | null; // 本地绝对路径，创作区选作参考图时派发给 ChatView 附件用
  status: 'success' | 'failed';
  failure_reason: string | null;
  source_product_id: string | null;
  source_product_title: string | null;
  source_image_urls: string[];
  quality_flag: 'good' | 'weak' | null; // 二创质检结果(其它类为 null)
  quality_note: string | null;
  created_at: string;
}

export interface PromptItem {
  id: string;
  category: string;
  name: string;
  content: string;
  is_default: boolean;
}

// 产品合成结果：带印花的平铺 T。
export interface MockupItem {
  id: string;
  url: string | null;
  design_label: string;
  design_url: string | null; // 溯源:用的哪个印花
  source_product_id: string | null; // 溯源:最初来自哪个采集的 Etsy 商品
  source_product_title: string | null;
  source_product_image: string | null; // 原始商品主图
  source_product_url: string | null; // 原始商品 Etsy 链接
  status: 'success' | 'failed';
  failure_reason: string | null;
  created_at: string;
}

export interface Cutout {
  id: string;
  source_count: number;
  cutout_url: string | null;
  status: 'success' | 'failed';
  failure_reason: string | null;
}

export interface LogItem {
  id: string;
  level: 'info' | 'warn' | 'error';
  scope: string;
  product: string | null; // 处理的商品标题
  images: string[]; // 输入图预览 URL
  message: string;
  created_at: string;
}

// SOP「一键出品」
export type SopStatus = 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
export type SopStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';
export interface SopStepDef {
  key: string;
  order: number;
  label: string;
  hint: string;
}
export interface SopRun {
  id: string;
  sop_key: string;
  product_ids: string[];
  status: SopStatus;
  total: number;
  started_at: string;
  ended_at?: string;
}
export interface SopStep {
  id: string;
  run_id: string;
  product_id: string;
  product_title?: string;
  step_key: string;
  step_order: number;
  status: SopStepStatus;
  summary?: string;
  failure_reason?: string;
  updated_at: string;
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
