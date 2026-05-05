/**
 * 合规校验 — 网文套路雷达
 *
 * 实现 docs/novel-trope-radar.md 第三章硬规则。
 * 任何代码改动若违反这些规则,该模块的相关测试会失败。
 *
 * 不导出过多 helper —— compliance 只暴露 schedule/install 路径需要的最小集合。
 */

import {
  ALL_PLATFORM_KEYS,
  DEFAULT_RUN_PARAMS,
  KB_COLLECTION_NAMES,
  RUN_PARAMS_BOUNDS,
  type NovelTropeRadarRunParams,
  type PlatformKey,
} from './types';

// ---- RunParams 校验 ----

export type RunParamsValidationResult =
  | { ok: true; value: NovelTropeRadarRunParams }
  | { ok: false; errors: string[] };

function isPlatformKey(value: unknown): value is PlatformKey {
  return typeof value === 'string'
    && ALL_PLATFORM_KEYS.includes(value as PlatformKey);
}

function clampNumber(
  raw: unknown,
  fallback: number,
  bounds: { min: number; max: number },
  field: string,
  errors: string[],
): number {
  if (raw === undefined || raw === null) return fallback;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    errors.push(`${field} 必须是有限数,实际: ${String(raw)}`);
    return fallback;
  }
  if (n < bounds.min || n > bounds.max) {
    errors.push(
      `${field} 超出范围 [${bounds.min}, ${bounds.max}],实际: ${n}`,
    );
  }
  return Math.max(bounds.min, Math.min(bounds.max, n));
}

function validateCron(raw: unknown, errors: string[]): string {
  const trimmed = (typeof raw === 'string' ? raw : '').trim();
  if (!trimmed) {
    errors.push('cron 不能为空');
    return DEFAULT_RUN_PARAMS.cron;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    errors.push(`cron 表达式格式错误,应为 5/6 段: "${trimmed}"`);
    return DEFAULT_RUN_PARAMS.cron;
  }
  return trimmed;
}

function validatePlatforms(raw: unknown, errors: string[]): PlatformKey[] {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) {
    errors.push('platforms 必须是非空数组');
    return [...DEFAULT_RUN_PARAMS.platforms];
  }
  const out: PlatformKey[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!isPlatformKey(item)) {
      errors.push(`platforms 包含未知平台: ${String(item)}`);
      continue;
    }
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  if (out.length === 0) {
    errors.push('platforms 中没有有效平台');
    return [...DEFAULT_RUN_PARAMS.platforms];
  }
  return out;
}

/**
 * 校验并规范化 run_params。缺省字段填默认值,字段越界裁剪并报错。
 * 任意错误 → ok:false。校验通过 → 返回规范化后的 params。
 */
export function validateRunParams(input: unknown): RunParamsValidationResult {
  const errors: string[] = [];
  const obj = (input && typeof input === 'object')
    ? (input as Record<string, unknown>)
    : {};

  const platforms = validatePlatforms(
    obj.platforms ?? DEFAULT_RUN_PARAMS.platforms,
    errors,
  );
  const topN = clampNumber(
    obj.topN, DEFAULT_RUN_PARAMS.topN,
    RUN_PARAMS_BOUNDS.topN, 'topN', errors,
  );
  const freeChapterLimit = clampNumber(
    obj.freeChapterLimit, DEFAULT_RUN_PARAMS.freeChapterLimit,
    RUN_PARAMS_BOUNDS.freeChapterLimit, 'freeChapterLimit', errors,
  );
  const perBookDelayMs = clampNumber(
    obj.perBookDelayMs, DEFAULT_RUN_PARAMS.perBookDelayMs,
    RUN_PARAMS_BOUNDS.perBookDelayMs, 'perBookDelayMs', errors,
  );
  const reviewLimit = clampNumber(
    obj.reviewLimit, DEFAULT_RUN_PARAMS.reviewLimit,
    RUN_PARAMS_BOUNDS.reviewLimit, 'reviewLimit', errors,
  );
  const cron = validateCron(
    obj.cron ?? DEFAULT_RUN_PARAMS.cron,
    errors,
  );

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      platforms,
      topN,
      freeChapterLimit,
      cron,
      perBookDelayMs,
      reviewLimit,
    },
  };
}

/** install API / scheduler 拉起前的硬保:校验失败抛错。 */
export function assertRunParamsValid(
  input: unknown,
): NovelTropeRadarRunParams {
  const result = validateRunParams(input);
  if (result.ok) {
    return result.value;
  }
  throw new Error(
    `[compliance] run_params 校验失败:\n  - ${result.errors.join('\n  - ')}`,
  );
}

// ---- 内容合规 ----

/**
 * 阈值:连续中日韩字符超过这个长度,视为疑似原文。
 * 用于校验非 corpus collection 的输出(snapshot / report)
 * 不应保留长段原文 —— LLM 提取后只保留结构化字段或抽象描述。
 */
const VERBATIM_CONTIGUOUS_THRESHOLD = 500;

/**
 * 校验:文本中不应出现 ≥500 字的连续中文段(typical 原文标志)。
 * 调用点:trope-extractor 输出落库前 / report 渲染后。
 *
 * 注意:本检查不是绝对的安全网,是工程层的 sanity check。
 * 真正的边界靠 prompt 设计 + collection 路由(corpus 隔离)。
 */
export function assertNoVerbatimChunk(text: string, context: string): void {
  if (typeof text !== 'string' || !text) return;
  const re = new RegExp(
    `([\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef]{${VERBATIM_CONTIGUOUS_THRESHOLD},})`,
  );
  const m = re.exec(text);
  if (m) {
    throw new Error(
      `[compliance] ${context} 输出疑似包含原文长段 (${m[1].length} 字)。`
      + ` 该 collection 不应保留原文,请检查 LLM prompt / 报告渲染逻辑。`,
    );
  }
}

/** 仅 corpus collection 名称白名单可写入原文。 */
export function isCorpusCollection(name: string): boolean {
  return name === KB_COLLECTION_NAMES.corpus;
}

/** 安全地确认目标 collection 名称 ∈ 已知三件套,避免误写其他位置。 */
export function isManagedCollection(name: string): boolean {
  return Object.values(KB_COLLECTION_NAMES).includes(
    name as (typeof KB_COLLECTION_NAMES)[keyof typeof KB_COLLECTION_NAMES],
  );
}

// ---- 单本抓取边界 ----

/**
 * 单本抓取前的 sanity check:
 * - 章节数不超过 freeChapterLimit
 * - chapter url 看起来不是登录墙或付费墙的常见标志
 *
 * 这不是反爬,是给 adapter 实现者的 self-check 提示。
 */
export function assertFreeChapterCount(
  chapters: { url?: string }[],
  params: NovelTropeRadarRunParams,
  bookKey: string,
): void {
  if (chapters.length > params.freeChapterLimit) {
    throw new Error(
      `[compliance] book ${bookKey} 抓取章节数 ${chapters.length}`
      + ` 超过 freeChapterLimit=${params.freeChapterLimit}`,
    );
  }
}
