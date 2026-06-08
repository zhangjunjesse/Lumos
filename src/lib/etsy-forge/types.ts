// Etsy 选品采集 — 共享类型。data-schema.json 是真源，这里是 TS 视角窄类型。
// 产品逻辑：关键词爬 Etsy 列表(主图+EHunt) → 勾选 → 爬详情图入图库。全程爬取不调图片服务商。

export type TaskSchedule = 'manual' | 'hourly' | 'daily' | 'weekly';
export type TaskStatus = 'idle' | 'running' | 'success' | 'failed' | 'partial' | 'cancelled';
export type ProductEhuntStatus = 'ok' | 'no_ehunt' | 'not_adspower' | 'bridge_unavailable' | 'failed';
export type DetailStatus = 'idle' | 'running' | 'success' | 'failed';
export type CutoutStatus = 'idle' | 'running' | 'success' | 'partial' | 'failed';
export type ShopCollectStatus = 'idle' | 'running' | 'success' | 'partial' | 'failed';
export type ShopEhuntStatus = 'idle' | 'success' | 'failed' | 'unavailable'; // unavailable=EHunt 在店铺页没注入(未接入,不编数)
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
  shop_name?: string; // 店铺名(采详情时从 listing 页抓)
  shop_url?: string; // 店铺主页 URL(etsy.com/shop/XXX),「采集店铺」步据此开店铺页
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

// 素材库：
//   生成类：场景图/模特图(空白T的人)/产品图(空白载体)
//   抠取类：pose=模特姿势(从原图抠真实模特)
//   二创类：remix=印花二创变体(基于抠出的印花+标题/卖点生成的新印花,SOP⑤产出,给⑥做产品图)
export type AssetCategory = 'scene' | 'model' | 'product' | 'pose' | 'remix';

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
  quality_flag?: 'good' | 'weak'; // 二创质量闸门结果:weak=有硬伤(白底框/多余文字/糊…)
  quality_note?: string; // weak 的原因
  series_of?: string; // playbook Step11 系列化:本张是哪个达标母版素材扩展出来的(空=普通二创)
  fission_run?: string; // 裂变:本张属于哪次裂变运行(供多轮面板按轮拉取)
  fission_stage?: string; // 裂变阶段:preview / finalize / iterate
  created_at: string;
}

// 提示词库：按分类(category)存提示词。每类可存多条，其中一条 is_default=true 为「当前生效」，
// 自动任务(抠印花/分析素材/抠姿势)读生效那条；用户没自定义时回退到 prompt-defaults 的内置默认。
//   cutout=抠印花 / scene=场景图生成 / model=模特图生成 / product=产品图生成 / pose=抠模特姿势
// product-merge=产品合成(把印花 inpaint 到确定颜色的空白 T 上，锁色)
// 二创两段式:remix-analyze=看参考印花出结构化设计简报(vision)；remix-variant=按简报+变体轴生成一张原创变体(模板)
export type PromptCategory = 'cutout' | 'scene' | 'model' | 'product' | 'pose' | 'product-merge' | 'remix-analyze' | 'remix-variant';

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

// 产品合成结果：印花 inpaint 到某张确定颜色空白 T 上得到的「带印花平铺 T」。
export interface MockupRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  design_label?: string; // 印花来源描述(印花/二创图)
  design_ref?: string; // 印花来源(本地 path 或 url，记录追溯用)
  source_product_id?: string; // 血缘:这印花最初来自哪个采集的 Etsy 商品(经抠印花/二创追溯)
  product_asset_id?: string; // 用的哪张产品图(素材库 product 类);内联生成(composer)的为空
  image_path?: string; // 生成的带印花 T 本地路径
  prompt?: string; // 内联生成(composer)的提示词
  ref_images?: string[]; // 内联生成用的参考图(path/url 列表),重试时复用
  score?: number; // 用户给这张产品图打的分(1-10;0/无=未打分),用于挑变体排序/筛选
  status: 'success' | 'failed';
  failure_reason?: string;
  created_at: string;
}

// 单发出图运行记录:「微调」「按方向出图」这类挂到产品下的单张生成,记 running→success/failed,供右下角「任务」浮层统一展示。
export interface MockupJobRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  kind: 'compose' | 'direction'; // compose=微调(自由提示词) / direction=按方向出图
  product_id: string; // 目标产品(采集 id / 手攒 id),浮层据此显示标题
  label?: string; // 展示细节:方向名(简约)或提示词片段
  status: 'running' | 'success' | 'failed';
  failure_reason?: string;
  created_at: string;
  finished_at?: string;
}

// 关注的店铺:一键出品时顺手采集商品对应店铺(按 shop_key 去重,多个商品同店聚合到一条)。
// 装修 = banner + 公告 + 代表 listing 图 + 整店首页截图。ehunt_status=unavailable 表示 EHunt 在店铺页未注入(未接入,不编数)。
export interface ShopRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  shop_key: string; // 去重键:店铺 slug(etsy.com/shop/<slug>)
  shop_name: string;
  url: string; // 店铺主页
  avatar_url?: string; // 头像(外链)
  location?: string; // 地点
  total_sales?: string; // 总销量(Etsy 自带)
  review_count?: string; // 评价数
  review_rating?: string; // 店铺综合评分
  since_year?: string; // 开店年份(On Etsy since)
  announcement?: string; // 公告/about 文案
  banner_path?: string; // 装修:banner 图(本地)
  rep_listing_paths?: string[]; // 装修:代表 listing 缩略图(本地)
  homepage_screenshot_path?: string; // 装修:整店首页截图(本地)
  ehunt_json?: string; // 店铺级 EHunt 原始文本(抓到才有)
  ehunt_bar_path?: string; // 店铺级 EHunt:注入 bar 元素截图(本地),直接展示这条原始长 bar
  ehunt_status: ShopEhuntStatus; // unavailable=未接入
  collect_status: ShopCollectStatus;
  failure_reason?: string;
  source_product_ids?: string[]; // 哪些商品指向这家店
  collected_at?: string;
  created_at: string;
}

// 手攒产品:用户在「我的产品」内联生成出来的产品组,无 Etsy 采集来源(不写进采集商品表)。
export interface ManualProductRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

// 裂变运行状态:供原图卡片显示「裂变中」。
export interface FissionRunRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  run_id: string; // 客户端生成的本次运行 id(也打在产出素材的 fission_run 上)
  product_id: string;
  base_asset_id: string; // 从哪张图发起的(原图卡片按它显示状态)
  stage: string;
  expected: number;
  created: number;
  status: 'running' | 'done' | 'failed';
  created_at: string;
}

// 裂变诊断缓存:同一张图诊断过就存下来,再开面板直接用,不重复调 vision(除非手动重诊断)。
export interface FissionDiagnosisRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  base_asset_id: string;
  strengths: string;
  weaknesses: string[];
  recommend: string[];
  note: string;
  created_at: string;
}

// 二创方向矩阵策略(A/B/C/D 等,动态、设置可增删改)。一键出品/图库二创按 code 选用。
export interface RemixStrategyRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  code: string; // A/B/C/D 或用户自定义
  label: string; // 中文方向名
  hint: string; // 一句话说明
  profile: string; // 英文,注入 {direction} 的"保留/改变/相似度目标"
  use_reference: boolean; // 是否喂参考图(贴近原图=true)
  high_similarity: boolean; // 高相似策略(非自有图红线:不做高相似复刻 → 跳过)
  is_default: boolean; // 没选时默认用它
  sort: number;
  enabled: boolean;
  created_at: string;
}

// 裂变·方向库一条方向(动态、可编辑)。axis A-H 用于规则判定 叠加/平行/矩阵。
export interface RemixDirectionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  axis: string; // A-H
  axis_name: string; // 轴中文名
  code: string; // A1...
  label: string; // 中文方向名
  hint: string; // 一句话作用
  prompt_fragment: string; // 注入出图 prompt 的英文片段
  sort: number;
  enabled: boolean;
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

// 详情图类型(②b AI 分类,可人工纠正):model_scene=商品图(带模特/场景) / product=产品图(只产品) / size=尺码图 / color=颜色图 / other=其他
export type ImageType = 'model_scene' | 'product' | 'size' | 'color' | 'other';

export interface DetailImageRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  product_id: string;
  listing_id: string;
  keyword: string;
  image_url: string;
  local_path?: string;
  image_type?: ImageType; // ②b 分类结果
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

// 运行日志：排查用，重点记图片生成(抠图/分析素材/抠姿势/产品合成/重试)的成功/失败明细。
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogRow extends Record<string, unknown> {
  id: string;
  level: LogLevel;
  scope: string; // 操作域，如「分析素材(场景)」「产品合成」「抠姿势」
  product?: string; // 处理的是哪个商品(标题),便于对应
  images?: string[]; // 输入图预览 URL(出图用了哪些图),日志里渲染成缩略图
  message: string;
  created_at: string;
}

// SOP「一键出品」编排：对 N 个商品逐商品独立走链(①采集→②a评论→②b分类→③抠印花→④素材+姿势→⑤二创→⑥产品图)。
// 一个 run 一条 SopRunRow，每商品每步一条 SopStepRow(可见状态/失败原因/可单步重试)。
export type SopStepKey = 'detail' | 'shop' | 'review' | 'classify' | 'cutout' | 'assets' | 'remix' | 'mockup';
export type SopStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';
export type SopRunStatus = 'running' | 'success' | 'partial' | 'failed' | 'cancelled';

export interface SopRunRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  sop_key: string; // 'one-click'
  product_ids: string[];
  directions?: string[]; // 一键出品选的二创方向(策略 code,可多选;空=默认策略)
  status: SopRunStatus;
  total: number;
  started_at: string;
  ended_at?: string;
}

export interface SopStepRow extends Record<string, unknown> {
  id: string;
  run_id: string;
  user_id: string;
  product_id: string;
  product_title?: string;
  step_key: SopStepKey;
  step_order: number; // 链中顺序，便于排序展示
  status: SopStepStatus;
  summary?: string; // 成功摘要，如「分类 8 张」「二创 5 个」
  failure_reason?: string;
  updated_at: string;
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
  MOCKUPS: 'etsy_forge_mockups',
  MOCKUP_JOBS: 'etsy_forge_mockup_jobs',
  MANUAL_PRODUCTS: 'etsy_forge_manual_products',
  SHOPS: 'etsy_forge_shops',
  REMIX_DIRECTIONS: 'etsy_forge_remix_directions',
  REMIX_STRATEGIES: 'etsy_forge_remix_strategies',
  FISSION_RUNS: 'etsy_forge_fission_runs',
  FISSION_DIAGNOSES: 'etsy_forge_fission_diagnoses',
  SOP_RUNS: 'etsy_forge_sop_runs',
  SOP_STEPS: 'etsy_forge_sop_steps',
  LOGS: 'etsy_forge_logs',
  RUNS: 'etsy_forge_runs',
  APP_SETTINGS: 'app_settings',
  RUN_HISTORY: 'run_history',
} as const;
