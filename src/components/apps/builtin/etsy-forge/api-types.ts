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
  series_of: string | null; // Step11 系列化:本张是哪个达标母版扩展出来的(普通二创为 null)
  fission_run: string | null; // 裂变:属于哪次裂变运行
  fission_stage: string | null; // 裂变阶段 preview/finalize/iterate
  created_at: string;
}

// 二创方向矩阵策略(A/B/C/D 等,动态可增删改)
export interface RemixStrategy {
  id: string;
  code: string;
  label: string;
  hint: string;
  profile: string;
  use_reference: boolean;
  high_similarity: boolean;
  is_default: boolean;
  sort: number;
  enabled: boolean;
}

// 出图团队:一键出品第⑦步由团队完成。团队=SOP(队长工作手册)+ 自由定义的成员。
// 成员无固定工种:duty 给队长派单看,prompt 是成员自己的人设,canGenerateImages 是唯一花钱的出图权限。
export interface TeamMember {
  id: string;
  name: string;
  duty: string; // 职能描述(给队长看:他擅长什么/负责什么,据此派单)
  prompt: string; // 人设/工作方式(注入成员自己的角色提示词)
  canGenerateImages: boolean; // 出图权限:能否调图片生成(唯一花钱的工具)
  enabled: boolean;
}

export interface AgentTeam {
  id: string;
  name: string;
  description?: string;
  is_default?: boolean; // 一键出品未指定团队时用它
  sop: string; // 队长工作手册:分工/流程/派单顺序/质量标准/失败应对,{N} 替换成每商品出图张数
  members: TeamMember[];
  images_per_run?: number; // 每商品目标出图张数(默认 5)
  created_at: string;
  updated_at: string;
}

// T恤模板:一张固定底图 + 印花区框(底图原始像素系)。一键出品第⑧步用 sharp 把印花合成到印花区。
export interface PrintArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MockupTemplate {
  id: string;
  name: string;
  base_path: string; // 底图本地路径,预览走 /api/media/serve?path=<encodeURIComponent(base_path)>
  print_area: PrintArea; // 底图原始像素系
  enabled: boolean;
  builtin?: boolean; // 内置模板:可停用不可删
  created_at: string;
  updated_at: string;
}

// 裂变·方向库一条方向
export interface RemixDirection {
  id: string;
  axis: string;
  axis_name: string;
  code: string;
  label: string;
  hint: string;
  prompt_fragment: string;
  sort: number;
  enabled: boolean;
}

// 裂变·诊断结果
export interface FissionDiagnosis {
  ok: boolean;
  strengths: string;
  weaknesses: string[];
  recommendCodes: string[];
  note: string;
  error?: string;
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
  prompt: string | null; // 内联生成(composer)的提示词
  score: number; // 用户评分 1-10(0=未打分)
  status: 'success' | 'failed';
  failure_reason: string | null;
  created_at: string;
}

// 单发出图运行记录(微调 / 按方向出图),供右下角「任务」浮层统一展示。
export interface MockupJob {
  id: string;
  kind: 'compose' | 'direction';
  kind_cn: string; // 微调 / 按方向出图
  title: string; // 目标产品标题
  label: string; // 方向名 / 提示词片段
  status: 'running' | 'success' | 'failed';
  started_at: string;
  failure_reason?: string;
}

// 手攒产品:用户手动新建的产品组(无 Etsy 采集来源)
export interface ManualProduct {
  id: string;
  name: string;
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
  optional?: boolean; // 可选步(采集店铺):失败不挡主链
}
export interface SopRun {
  id: string;
  sop_key: string;
  product_ids: string[];
  directions?: string[]; // 一键出品选的二创方向(策略 code,可自定义)
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

// 关注的店铺(一键出品「采集店铺」步产出)。ehuntStatus=unavailable 表示 EHunt 在店铺页未接入(不编数)。
export interface Shop {
  id: string;
  shop_name: string;
  url: string;
  avatar_url: string | null;
  location: string | null;
  total_sales: string | null;
  review_count: string | null;
  review_rating: string | null;
  since_year: string | null;
  announcement: string | null;
  banner: string | null; // 装修:banner(已转 /api/media/serve)
  rep_listings: string[]; // 装修:代表 listing 图
  screenshot: string | null; // 装修:整店首页截图
  ehunt_status: 'idle' | 'success' | 'failed' | 'unavailable';
  ehunt: { raw?: string } | null;
  collect_status: 'idle' | 'running' | 'success' | 'partial' | 'failed';
  failure_reason: string | null;
  product_count: number;
  collected_at: string | null;
}
