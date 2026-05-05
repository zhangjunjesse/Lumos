/**
 * 网文套路雷达 — 类型定义
 *
 * 详细说明见 docs/novel-trope-radar.md。
 * 上下文恢复优先级:GOAL 文档 → 本文件 → 实施代码。
 */

// ---- 平台 ----

export type PlatformKey =
  | 'fanqie'
  | 'qidian'
  | 'jjwxc'
  | 'qimao'
  | 'faloo'
  | 'zongheng'
  | '17k'
  | 'ciweimao'
  | 'sfacg'
  | 'hongxiu';

export const ALL_PLATFORM_KEYS: readonly PlatformKey[] = [
  'fanqie', 'qidian', 'jjwxc', 'qimao',
  'faloo', 'zongheng', '17k',
  'ciweimao', 'sfacg', 'hongxiu',
] as const;

export const CORE_PLATFORM_KEYS: readonly PlatformKey[] = [
  'fanqie', 'qidian', 'jjwxc', 'qimao',
] as const;

// ---- RunParams (schedule.run_params 的 JSON) ----

export interface NovelTropeRadarRunParams {
  /** 本轮启用的平台列表 */
  platforms: PlatformKey[];
  /** 每平台抓 Top N 本 */
  topN: number;
  /** 每本最多抓多少章免费试读 */
  freeChapterLimit: number;
  /** Cron 表达式 (调度层用) */
  cron: string;
  /** 单本之间最小间隔 ms */
  perBookDelayMs: number;
  /** 单本最多抓多少条公开书评 */
  reviewLimit: number;
}

export const DEFAULT_RUN_PARAMS: NovelTropeRadarRunParams = {
  platforms: [...CORE_PLATFORM_KEYS],
  topN: 50,
  freeChapterLimit: 3,
  cron: '0 9 * * 1',
  perBookDelayMs: 2000,
  reviewLimit: 20,
};

export const RUN_PARAMS_BOUNDS = {
  topN: { min: 1, max: 100 },
  freeChapterLimit: { min: 1, max: 10 },
  perBookDelayMs: { min: 1000, max: 30000 },
  reviewLimit: { min: 0, max: 100 },
} as const;

// ---- 抓取产物 ----

export interface BookMeta {
  /** hash(platform + bookId),全局去重 key */
  bookKey: string;
  platform: PlatformKey;
  bookId: string;
  rank: number;
  url: string;
  title: string;
  author: string;
  category: string;
  tags: string[];
  intro: string;
  fetchedAt: string;
}

export interface FreeChapter {
  bookKey: string;
  chapterIndex: number;
  chapterTitle: string;
  url: string;
  /** 仅免费试读章原文 */
  content: string;
  wordCount: number;
  fetchedAt: string;
}

export interface PublicReview {
  bookKey: string;
  /** 评论文本 */
  text: string;
  likes: number;
  // 不存 username / uid / avatar
}

export interface BookSnapshot {
  meta: BookMeta;
  chapters: FreeChapter[];
  reviews: PublicReview[];
}

// ---- LLM 提炼后的结构化字段 ----

export type GoldenFinger =
  | 'system'
  | 'rebirth'
  | 'transmigration'
  | 'bloodline'
  | 'pretend-weak'
  | 'space'
  | 'time-travel'
  | 'fate'
  | 'none'
  | 'other';

export type Pacing = 'per-chapter' | 'every-3' | 'every-10' | 'slow-burn';

export interface TropeRecord {
  bookKey: string;
  platform: PlatformKey;
  /** ISO week id, e.g. "2026-W18" */
  weekId: string;
  rank: number;

  // 来自平台公开元数据
  title: string;
  author: string;
  category: string;
  tags: string[];

  // LLM 提炼字段
  genre: string;
  goldenFinger: GoldenFinger | string;
  /** 抽象类型(类目),非原句 */
  openingHookType: string;
  protagonistArchetype: string;
  pacing: Pacing;
  antagonistType: string;
  emotionalAxis?: string;
  tropeTags: string[];

  // 读者反馈聚合(非原评论)
  readerPainPoints: string[];
  readerHighPoints: string[];

  /** 引用回 corpus collection 的 chapter url 列表,RAG 拼上下文用 */
  freeChapterRefs: string[];
}

// ---- 周报 ----

export interface TropeTagDelta {
  tag: string;
  thisWeek: number;
  lastWeek: number;
}

export interface TropeCombination {
  a: string;
  b: string;
  examples: string[];
}

export interface CrossPlatformTrend {
  tag: string;
  from: PlatformKey;
  to: PlatformKey[];
}

export interface HookPattern {
  /** 抽象后的 hook 模式描述,非原句 */
  pattern: string;
  count: number;
  exampleBookKeys: string[];
}

export interface WeeklyReport {
  weekId: string;
  generatedAt: string;
  platforms: PlatformKey[];
  risingTropes: TropeTagDelta[];
  decliningTropes: TropeTagDelta[];
  newCombinations: TropeCombination[];
  crossPlatformSpread: CrossPlatformTrend[];
  hookPatternArchive: HookPattern[];
  /** 渲染后的完整周报 markdown */
  markdown: string;
}

// ---- 平台配置 (供 DSL inline script 消费) ----

export interface RankSelectors {
  listItem: string;
  title: string;
  author: string;
  category: string;
  intro: string;
  link: string;
  rankBadge?: string;
}

export interface BookSelectors {
  title: string;
  author: string;
  intro: string;
  tag: string;
  chapterListItem: string;
  chapterFreeBadge?: string;
  chapterLink: string;
}

export interface ReaderSelectors {
  title: string;
  content: string;
}

export interface ReviewSelectors {
  listItem: string;
  text: string;
  likes: string;
}

export type FreeChapterStrategy = 'badge-only' | 'first-n';

export interface PlatformConfig {
  platform: PlatformKey;
  humanName: string;
  baseUrl: string;
  rank: {
    url: string;
    selectors: RankSelectors;
    /** 从 href 抠 bookId 的正则字符串,必须有一个 capture group */
    bookIdRegex: string;
  };
  book: {
    /** url 模板,${id} 占位符 */
    urlTemplate: string;
    selectors: BookSelectors;
    reader: ReaderSelectors;
    freeStrategy: FreeChapterStrategy;
  };
  reviews: {
    /** 从书页 url 派生书评页 url 的表达式,${url} 引用书页 url */
    pageUrlExpr: string;
    selectors: ReviewSelectors;
  };
}

// ---- KB Collections ----

export const KB_COLLECTION_NAMES = {
  /** 试读章节原文 + 出处。本地学习专用,禁外传/同步。 */
  corpus: 'novel-trope-corpus',
  /** 周快照(TropeRecord[] JSON),供周间 diff */
  snapshot: 'novel-trope-snapshot',
  /** 周报 markdown,供 RAG 召回趋势分析 */
  report: 'novel-trope-report',
} as const;

export type KbCollectionKey = keyof typeof KB_COLLECTION_NAMES;

/** corpus collection 的 description 标记字符串,用于禁外传校验 */
export const CORPUS_PROTECT_FLAG = 'personal_study_corpus=true';
