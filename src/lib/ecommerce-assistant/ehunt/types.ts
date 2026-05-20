/**
 * EHunt 选品支持 + 评论情报的类型契约。
 *
 * 设计要点（见 docs/ecommerce-ehunt-review-intel-guide.md）：
 * - EHunt 注入指标仅在 AdsPower 上下文且页面检测到 EHunt 时可得；缺失要如实暴露，不 mock。
 * - 原始评论走 Etsy `deep_dive_reviews` 接口，**不依赖 EHunt**，只要浏览器上下文登录了 Etsy。
 * - 评论分析用 Lumos 自有 LLM 复刻 EHunt 产出，默认不触发、用户手动触发、按内容 hash 缓存。
 */

/** 采集 / 探测各环节的可见状态。UI 据此显示真实原因，禁止用占位冒充成功。 */
export type EhuntCollectStatus =
  | 'ok'
  | 'not_adspower' // 浏览器上下文不是 AdsPower profile
  | 'no_ehunt' // AdsPower 上下文但页面未检测到 EHunt 注入痕迹
  | 'needs_login' // Etsy 接口返回结构提示未登录 / 非 member
  | 'etsy_contract_changed' // deep_dive_reviews 响应结构与已验证契约不符（逆向风险）
  | 'bridge_unavailable' // Browser Bridge 未连接
  | 'failed'; // 其它运行期失败，message 携带原因

/** 浏览器上下文 + 页面的 EHunt 可用性探测结果。 */
export interface EhuntDetectionResult {
  /** browserContextId 是否 `adspower:` 前缀。 */
  isAdsPowerContext: boolean;
  /** 当前页面是否出现 EHunt 注入痕迹（面板 / Batch Analysis 栏 / 扩展资源 / 指标标签）。 */
  ehuntDetected: boolean;
  status: Extract<EhuntCollectStatus, 'ok' | 'not_adspower' | 'no_ehunt' | 'bridge_unavailable' | 'failed'>;
  /** 面向 UI 的中文原因，例如 "未接入 EHunt（需 AdsPower + 已安装 EHunt 扩展）"。 */
  reason: string;
}

/**
 * EHunt 注入到 Etsy 商品卡 / 详情页的指标。
 * 原始文本与解析值都保留：解析失败不致命，原文可供排查。
 */
export interface EhuntMetrics {
  /** 总销量。来自 `Sales: 708(42)` 的 708。 */
  salesTotal: number | null;
  /** 近期销量。来自 `Sales: 708(42)` 的 42。 */
  salesRecent: number | null;
  /** 收藏数解析值（`4.0K` → 4000）。 */
  favorites: number | null;
  /** 店铺周销。 */
  storeWeeklySales: number | null;
  /** 上架日期原文（如 `11/22/25`）。 */
  listedDate: string | null;
  /** 详情页可能额外出现：总浏览 / 评论占比 / 店铺总销 / BestSeller / 库存。仅详情页有效。 */
  totalViews?: number | null;
  reviewRatio?: string | null;
  storeSales?: number | null;
  bestSeller?: boolean;
  stocks?: number | null;
  /** 抽取到的原始文本片段，解析异常时供排查。 */
  raw: Record<string, string>;
}

/** 单条标准化评论。Etsy 响应内嵌套字段路径在 etsy-reviews.ts 映射，这里是归一后的契约。 */
export interface RawReview {
  transactionId: string;
  rating: number | null;
  /** 评论展示日期原文。 */
  date: string | null;
  text: string;
  buyerName: string | null;
  /** 变体摘要，如 "Apron Color: Brown, Embroidery Style: Style 2"。 */
  variations: string | null;
  hasPhoto: boolean;
  /** 卖家回复正文（如有）。 */
  sellerResponse: string | null;
}

/** Etsy 自带的标签情感（已是高质量先验，喂分析可省 token）。 */
export interface EtsyReviewTag {
  tag: string;
  frequency: number;
}

/** 一个 listing 的完整评论采集结果。 */
export interface EtsyReviewBundle {
  listingId: string;
  shopId: string | null;
  totalReviews: number;
  averageRating: number | null;
  /** 1..5 星各计数，键为字符串以对齐 Etsy 响应。 */
  ratingCounts: Record<string, number>;
  tagFilters: EtsyReviewTag[];
  reviews: RawReview[];
  /** 抓取页数 / 应有页数，便于校验是否抓全。 */
  pagesFetched: number;
  totalPages: number;
  capturedAt: string;
  status: EhuntCollectStatus;
  /** 非 ok 状态的可见原因。 */
  message?: string;
}

/** 单组 topic + reason，对齐 EHunt 的好评/差评/预期/动机结构。 */
export interface ReviewIntelEntry {
  topic: string;
  reason: string;
}

/** 评论分析产出，复刻 EHunt AI Review Analysis。 */
export interface ReviewIntel {
  customerProfile: {
    genderSplit: string | null;
    who: string[];
    when: string[];
    where: string[];
    what: string[];
  };
  pros: ReviewIntelEntry[];
  cons: ReviewIntelEntry[];
  expectations: ReviewIntelEntry[];
  motivations: ReviewIntelEntry[];
  /** 生成元信息 + 缓存键。 */
  model: string;
  analyzedAt: string;
  /** 参与分析的评论内容 hash，评论未变则命中缓存不重复调用 LLM。 */
  reviewHash: string;
}

/** EHunt 扩展 ID，仅用于"页面是否出现该扩展资源"的探测。 */
export const EHUNT_EXTENSION_ID = 'pmpgnefoilpinnblccjddomajohmbpko';
