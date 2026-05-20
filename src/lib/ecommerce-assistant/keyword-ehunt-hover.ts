/**
 * EHunt 逐 tag hover 关键词表现提取（类目&关键词调研自有，**不依赖也不修改**
 * 并行域的 ehunt/*；直接用共享底层 `browser-runtime/bridge-client` 驱动页面）。
 *
 * 机制（与用户描述一致）：进 listing 页（EHunt 扩展所在的浏览器上下文会注入
 * tag 数据）→ 逐个 tag 触发 mouseover → 抓 EHunt 悬浮窗文本 → 解析搜索量/
 * 竞争度/趋势。EHunt 未就绪（未装/未登录/非 AdsPower 上下文）→ 如实返回
 * reason，**绝不伪造**（用户要求不降级 = 不做"词频冒充"产品态；EHunt 真缺
 * 时给可操作错误，而非假数据）。per-tag 解析失败保留 raw 供诊断与调优。
 */
import {
  resolveBrowserBridgeRuntimeConfig,
  postToBrowserBridge,
  type BrowserBridgeRuntimeConfig,
  type BrowserBridgeResponse,
} from '@/lib/browser-runtime/bridge-client';
import {
  createHoverLog,
  isTransientNavError,
  type HoverLog,
} from './keyword-ehunt-diagnostics';
import { HOVER_SCRIPT, SETTLE_SCRIPT } from './keyword-ehunt-script';

const LOCK_OWNER = 'ecommerce-keyword-research';
const NEW_PAGE_TIMEOUT_MS = 45_000;
// 页面执行中跳转把脚本 context 销毁是**瞬态**错（Etsy 早期重定向）；
// 退避后页面已落到稳定 context，再 evaluate 即可成。最多 3 次尝试。
const MAX_EVAL_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 6000;
const SETTLE_TIMEOUT_MS = 30_000; // 预稳探针内含 ≤25s + 余量
// 页内脚本内含 ~20s DOM 就绪 + 最长 ~55s EHunt 注入轮询 + 最多 15 tag×~2s
// hover + 余量。EHunt 在"页面完全加载完"后才注入数据（用户反复强调、
// 姊妹 ehunt 模块实测 ~45s），就绪窗口必须真的等够，否则系统性误报未检测。
const EVAL_TIMEOUT_MS = 200_000;

export type Competition = 'low' | 'medium' | 'high' | 'unknown';
export type Trend = 'rising' | 'falling' | 'stable' | 'unknown';

export interface TagPerformance {
  tag: string;
  searchVolume: number | null;
  competition: Competition;
  /** EHunt tooltip 的 Competition 裸数值（如 42400）；按类目中位数分档前保留。 */
  competitionRaw: number | null;
  trend: Trend;
  /** 悬浮窗原始文本（解析失败时据此诊断/调选择器，不丢不造）。 */
  raw: string;
  parsed: boolean;
}

export interface ListingHoverResult {
  url: string;
  ehuntDetected: boolean;
  reason?: string;
  tags: TagPerformance[];
  /** EHunt 检测到但无浮窗时回传的真实注入 DOM 结构快照（供按真机调）。 */
  domProbe?: string;
}

interface NewPageResp extends BrowserBridgeResponse {
  pageId?: string;
}
interface EvalResp extends BrowserBridgeResponse {
  value?: unknown;
  result?: unknown;
}

interface RawScriptOut {
  ehuntDetected: boolean;
  reason?: string;
  tags: { tag: string; raw: string }[];
  domProbe?: string;
}

/** 解析 bridge 配置；未连接返回 null（调用方据此给可见原因，不抛）。 */
export function resolveKeywordBridgeConfig(
  browserContextId: string,
): BrowserBridgeRuntimeConfig | null {
  return resolveBrowserBridgeRuntimeConfig({ browserContextId, lockOwnerId: LOCK_OWNER });
}

/** "16.1M" / "719.2K" / "2,306" / "42.4K" → 数值。失败 → null。 */
function num(s: string | undefined): number | null {
  if (!s) return null;
  const m = /([\d][\d.,]*)\s*([kmb])?/i.exec(s);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const u = (m[2] || '').toLowerCase();
  const mult = u === 'k' ? 1_000 : u === 'm' ? 1_000_000 : u === 'b' ? 1_000_000_000 : 1;
  return Math.round(base * mult);
}

/**
 * 解析 EHunt hover tooltip（bridge 自驱实测原文，多行）：
 *   Views:  total (16.1M)  monthly (2.9M)
 *   Favorites:  total (719.2K)  monthly (2.0K)
 *   Sales:  total (399.3K)  monthly (10.4K)
 *   Competition:  42.4K
 * 取 **Views monthly** 作搜索量代理（月级流量最贴近"搜索热度"），
 * **Competition 裸数值** 入 competitionRaw（分档由 analyzeCategory 按类目
 * 中位数决定，对齐 SOP 的中位分界，避免凭空设阈值）。trend 此视图无 → unknown。
 * 内联兜底：若 raw 只是 "(16.1M)" 这类单值（hover 没出 tooltip 时），仍取作
 * searchVolume，competitionRaw=null（下游降级 volume-only，不伪造竞争度）。
 */
export function parseTag(tag: string, raw: string): TagPerformance {
  const text = (raw || '').replace(/[ \t]+/g, ' ').trim();
  const viewsMonthly = num(/Views:[^\n]*?monthly\s*\(([^)]+)\)/i.exec(text)?.[1]);
  const viewsTotal = num(/Views:\s*total\s*\(([^)]+)\)/i.exec(text)?.[1]);
  const competitionRaw = num(/Competition:\s*\(?\s*([\d.,]+\s*[kmb]?)/i.exec(text)?.[1]);
  // 有 tooltip → Views monthly（无则 total）；无结构 → 退化为整串单值。
  const searchVolume =
    viewsMonthly ?? viewsTotal ?? (/Views:|Competition:/i.test(text) ? null : num(text.replace(/[()]/g, '')));
  return {
    tag,
    searchVolume,
    competition: 'unknown', // 真实分档由 analyzeCategory 按类目中位数定
    competitionRaw,
    trend: 'unknown',
    raw: text.slice(0, 240),
    parsed: searchVolume !== null,
  };
}

function parseScriptOut(raw: unknown): RawScriptOut | null {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as RawScriptOut;
    } catch {
      return null;
    }
  }
  return raw && typeof raw === 'object' ? (raw as RawScriptOut) : null;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/**
 * 预稳：短探针等页面跳转/重定向落定（readyState complete + URL 稳定）再放
 * 重脚本上场。从已知错误推出的硬化——Etsy 早期重定向落在这个廉价短探针
 * 期间而非 75s 重脚本期间，从根上规避 "Execution context was destroyed"。
 * 永不抛；非瞬态/耗尽也返回（重脚本内部 readiness+retry 兜底）。
 */
async function settlePage(
  config: BrowserBridgeRuntimeConfig,
  pageId: string,
  log: HoverLog,
  signal?: AbortSignal,
): Promise<void> {
  for (let s = 1; s <= MAX_EVAL_ATTEMPTS; s += 1) {
    if (signal?.aborted) return;
    try {
      log.step(`预稳探针 第 ${s}/${MAX_EVAL_ATTEMPTS} 次`);
      const res = await postToBrowserBridge<EvalResp>(
        config,
        '/v1/pages/evaluate',
        { pageId, expression: SETTLE_SCRIPT, background: true },
        { signal, timeoutMs: SETTLE_TIMEOUT_MS },
      );
      const o = parseScriptOut(res.value ?? res.result ?? null) as
        | { ready?: boolean }
        | null;
      log.step(`预稳返回 ready=${o?.ready ? 1 : 0}`);
      return; // 探针成功返回即说明当前 context 已稳定，进重脚本
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log.step(`预稳第 ${s} 次失败：${m}`);
      if (isTransientNavError(m) && s < MAX_EVAL_ATTEMPTS) {
        await delay(RETRY_BACKOFF_MS, signal);
        continue;
      }
      return;
    }
  }
}

/**
 * 对单个 listing 做 EHunt tag hover 提取。永不抛：失败返回 reason。
 * 真因（真机诊断坐实）：Etsy listing 页加载早期会跳转/重定向，把页内
 * 脚本的执行 context 销毁 → "Execution context was destroyed"，整段失败。
 * 对策：捕获这类**瞬态**导航错误，退避后重试 evaluate（页面已稳定）；
 * 全程打日志，失败把轨迹回写进 reason，终结"无日志只能盲猜"。
 */
export async function extractListingTagPerformance(
  config: BrowserBridgeRuntimeConfig,
  url: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ListingHoverResult> {
  const log = createHoverLog(url);
  let pageId: string | null = null;
  try {
    log.step('打开页面(background)');
    const created = await postToBrowserBridge<NewPageResp>(
      config,
      '/v1/pages/new',
      { url, background: true },
      { signal: opts.signal, timeoutMs: NEW_PAGE_TIMEOUT_MS },
    );
    pageId = typeof created.pageId === 'string' && created.pageId.trim() ? created.pageId : null;
    if (!pageId) {
      log.step('未拿到 pageId');
      return { url, ehuntDetected: false, reason: '浏览器 bridge 未能打开页面（未连接/上下文不可用）' + log.trace(), tags: [] };
    }

    // 预稳：先让页面跳转/重定向落定，再跑重脚本（规避 context destroyed）。
    await settlePage(config, pageId, log, opts.signal);

    let lastErr = '';
    for (let attempt = 1; attempt <= MAX_EVAL_ATTEMPTS; attempt += 1) {
      if (opts.signal?.aborted) break;
      try {
        log.step(`evaluate 第 ${attempt}/${MAX_EVAL_ATTEMPTS} 次`);
        const res = await postToBrowserBridge<EvalResp>(
          config,
          '/v1/pages/evaluate',
          { pageId, expression: HOVER_SCRIPT, background: true },
          { signal: opts.signal, timeoutMs: EVAL_TIMEOUT_MS },
        );
        const parsedOut = parseScriptOut(res.value ?? res.result ?? null);
        if (!parsedOut) {
          lastErr = '页内脚本无有效返回';
          log.step(`第 ${attempt} 次：${lastErr}`);
          if (attempt < MAX_EVAL_ATTEMPTS) { await delay(RETRY_BACKOFF_MS, opts.signal); continue; }
          break;
        }
        const tags = (parsedOut.tags ?? []).map((t) => parseTag(t.tag, t.raw ?? ''));
        log.step(`成功 ehunt=${parsedOut.ehuntDetected ? 1 : 0} tags=${tags.length}`);
        return {
          url,
          ehuntDetected: !!parsedOut.ehuntDetected,
          reason: parsedOut.reason ? parsedOut.reason + log.trace() : undefined,
          tags,
          domProbe: parsedOut.domProbe,
        };
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        const transient = isTransientNavError(lastErr);
        log.step(`第 ${attempt} 次失败(${transient ? '瞬态导航' : '确定性'})：${lastErr}`);
        if (transient && attempt < MAX_EVAL_ATTEMPTS) {
          await delay(RETRY_BACKOFF_MS, opts.signal);
          continue;
        }
        break; // 确定性错误重试无意义；瞬态但已耗尽次数
      }
    }
    return {
      url,
      ehuntDetected: false,
      reason: `EHunt 提取失败：${lastErr || '未知'}` + log.trace(),
      tags: [],
    };
  } catch (err) {
    log.step(`外层异常：${err instanceof Error ? err.message : String(err)}`);
    return {
      url,
      ehuntDetected: false,
      reason: `EHunt 提取失败：${err instanceof Error ? err.message : String(err)}` + log.trace(),
      tags: [],
    };
  } finally {
    if (pageId) {
      try {
        await postToBrowserBridge(
          config,
          '/v1/pages/close',
          { pageId, background: true },
          { timeoutMs: 8000 },
        );
      } catch {
        /* cleanup best-effort */
      }
    }
  }
}
