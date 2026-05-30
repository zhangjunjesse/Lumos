// Etsy 选品采集 — 共享类型。data-schema.json 是真源，这里是 TS 视角窄类型。
// 产品逻辑：关键词爬 Etsy 列表(主图+EHunt) → 勾选 → 爬详情图入图库。全程爬取不调图片服务商。

export type TaskSchedule = 'manual' | 'hourly' | 'daily' | 'weekly';
export type TaskStatus = 'idle' | 'running' | 'success' | 'failed' | 'partial' | 'cancelled';
export type ProductEhuntStatus = 'ok' | 'no_ehunt' | 'not_adspower' | 'bridge_unavailable' | 'failed';
export type DetailStatus = 'idle' | 'running' | 'success' | 'failed';
export type CutoutStatus = 'idle' | 'running' | 'success' | 'partial' | 'failed';
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
  min_sales?: number; // 采集过滤门槛：销量 < 此值不采（需 EHunt 指标）
  min_favorites?: number; // 采集过滤门槛：收藏 < 此值不采
  min_price?: number; // 采集过滤门槛：价格 < 此值不采（按商品卡标价，0=不限）
  max_price?: number; // 采集过滤门槛：价格 > 此值不采（按商品卡标价，0=不限）
  max_pages?: number; // 最大翻页数（默认 40，硬上限 100）：控制往深里翻多少页找达标新品
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
  run_id?: string;
  run_at?: string;
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
  tags?: string[]; // 用户在图库里给商品打的标签
  review_count?: number; // 采详情时抓到的评论数
  review_analysis?: ReviewAnalysis; // AI 评论分析结果（缓存）
  review_analyzed_at?: string;
  cutout_status?: CutoutStatus; // 抠图状态
  cutout_count?: number; // 已成功抠图数
  asset_status?: CutoutStatus; // 素材分析状态（idle/running/success/partial/failed）
  pose_status?: CutoutStatus; // 抠姿势状态（从原图逐张抠模特）
  created_at: string;
}

// 素材库：四类素材——
//   生成类(看商品图生成)：场景图(环境)/模特图(空白T的人)/产品图(空白载体)
//   抠取类(从原图抠)：pose=模特姿势(从含模特的原图抠出真实模特,保留姿势和衣服)
export type AssetCategory = 'scene' | 'model' | 'product' | 'pose';

export interface AssetRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  category: AssetCategory;
  product_id?: string; // 来源商品（哪个商品分析出来的）
  source_image_ids?: string[]; // 用了哪些原始详情图作参考
  description?: string; // AI 看图得到的该类描述
  image_path?: string; // 生成的素材图本地路径（经 /api/media/serve 显示）
  status: 'success' | 'failed';
  failure_reason?: string;
  created_at: string;
}

// 提示词库：按分类(category)存提示词。每类可存多条，其中一条 is_default=true 为「当前生效」，
// 自动任务(抠印花/分析素材/抠姿势)读生效那条；用户没自定义时回退到 prompt-defaults 的内置默认。
//   cutout=抠印花 / scene=场景图生成 / model=模特图生成 / product=产品图生成 / pose=抠模特姿势
export type PromptCategory = 'cutout' | 'scene' | 'model' | 'product' | 'pose';

export interface PromptRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  category: PromptCategory;
  name: string;
  content: string;
  is_default?: boolean; // 该分类下「当前生效」的那条
  created_at: string;
}

export interface CutoutRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  product_id: string; // 一个产品一条抠图结果
  source_count: number; // 抠图用了该产品几张图
  cutout_path?: string; // 抠图结果本地路径（~/.lumos/.lumos-media/，前端经 /api/media/serve 显示）
  status: 'success' | 'failed';
  failure_reason?: string;
  created_at: string;
}

export interface ReviewRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  product_id: string;
  listing_id: string;
  author?: string;
  rating?: string;
  date?: string;
  region?: string;
  text: string;
  created_at: string;
}

// AI 评论分析：topic = 英文关键词，reason = 中文总结。
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
  REVIEWS: 'etsy_forge_reviews',
  CUTOUTS: 'etsy_forge_cutouts',
  PROMPTS: 'etsy_forge_prompts',
  ASSETS: 'etsy_forge_assets',
  RUNS: 'etsy_forge_runs',
  APP_SETTINGS: 'app_settings',
  RUN_HISTORY: 'run_history',
} as const;
