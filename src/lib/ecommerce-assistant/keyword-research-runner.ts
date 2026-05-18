/**
 * 类目&关键词调研 —— 编排运行时（完整版，无降级冒充）。
 *
 * 选类目 → Etsy 搜到 listing → 在 EHunt 所在浏览器上下文逐 listing 打开、
 * 对每个 tag hover 抓搜索量/竞争度/趋势 → 四象限+健康度+红灯 → 报告。
 * EHunt 未就绪：该类目 ok:false 带可操作原因，不伪造、不退化成词频。
 * 反爬：每类目限采样 listing 数 + listing 间随机间隔。可取消。
 * ehunt/* 为并行域：本模块只用共享底层 bridge-client，不 import/改其内部。
 */
import { buildPlatformSearchUrl, fetchSearchSamples } from './web-research';
import { getBrowserFetchSettings } from './discover-settings';
import { resolveCatalogTargets, type CatalogTarget } from './category-catalog';
import { analyzeCategory } from './keyword-extract';
import { composeKeywordReport } from './keyword-report';
import {
  resolveKeywordBridgeConfig,
  extractListingTagPerformance,
  type ListingHoverResult,
} from './keyword-ehunt-hover';
import type { CategoryKeywordResult } from './keyword-research-types';
import {
  createKeywordRun,
  getKeywordStore,
  getKeywordRun,
  patchKeywordRun,
  persistKeywordReport,
} from './keyword-research-storage';
import {
  registerKeywordRun,
  unregisterKeywordRun,
  cancelKeywordRun,
} from './keyword-research-lifecycle';

export { cancelKeywordRun };

const MAX_SAMPLES_PER_CATEGORY = 24;
const MAX_LISTINGS_HOVER = 12; // 反爬：每类目最多进 12 个 listing 做 hover
const LISTING_GAP_MIN_MS = 3000;
const LISTING_GAP_MAX_MS = 8000;
// 熔断：前 N 个 listing 全未检测到 EHunt → 本次 EHunt 系统性不可用，
// 不再磨剩余 listing（hover 内部每个还有最多 3 次重试，否则单类目最坏
// 数小时才失败）。EHunt 正常（前 N 个里有一个检测到）则照常跑满。
const EHUNT_PROBE_LISTINGS = 3;

class KeywordAbortError extends Error {
  constructor() {
    super('keyword research aborted');
    this.name = 'KeywordAbortError';
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(t); reject(new KeywordAbortError()); };
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function startKeywordResearch(categoryIds: string[]): Promise<{ id: string }> {
  const ids = [...new Set(categoryIds.map((s) => String(s).trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error('请至少选择一个类目');
  const targets = resolveCatalogTargets(ids);
  if (targets.length === 0) throw new Error('所选类目无效或无可采集叶子');

  const store = getKeywordStore();
  const label = targets.map((t) => t.name).slice(0, 4).join('、') + (targets.length > 4 ? ` 等 ${targets.length} 项` : '');
  const row = createKeywordRun(store, { categoryIds: ids, categoryLabel: label });
  const controller = registerKeywordRun(row.id);
  if (controller) void runInBackground(row.id, targets, controller);
  return { id: row.id };
}

async function collectCategory(
  store: ReturnType<typeof getKeywordStore>,
  t: CatalogTarget,
  bridgeOk: boolean,
  bridgeReason: string,
  signal: AbortSignal,
  onProgress: (listingDone: number, listingTotal: number, note: string) => void,
): Promise<CategoryKeywordResult> {
  const noData = (reason: string, titles: string[] = []): CategoryKeywordResult => {
    const r = analyzeCategory({ ...meta(t), listings: [], titles });
    return { ...r, reason, recommendation: `本类目未产出关键词分析。${reason}` };
  };
  const built = buildPlatformSearchUrl('etsy', t.query);
  if (!built) return noData('etsy 搜索 URL 构造失败');

  let titles: string[] = [];
  let urls: string[] = [];
  try {
    const r = await fetchSearchSamples({
      source: built.source,
      url: built.url,
      acceptLanguage: built.acceptLanguage,
      abortSignal: signal,
      maxSamples: MAX_SAMPLES_PER_CATEGORY,
      store,
    });
    const samples = dedupeSamples(r.samples ?? []);
    titles = samples.map((s) => s.title).filter(Boolean);
    urls = samples.map((s) => s.url).filter((u): u is string => !!u && /^https?:\/\//.test(u));
    if (samples.length === 0) return noData(r.warning ?? '未采到商品（可能反爬/无结果）');
  } catch (err) {
    if (signal.aborted) throw new KeywordAbortError();
    return noData(`Etsy 采集失败：${err instanceof Error ? err.message : String(err)}`);
  }

  if (!bridgeOk) return noData(bridgeReason, titles);

  const config = resolveKeywordBridgeConfig(getBrowserFetchSettings(store).browserContextId);
  if (!config) return noData('浏览器 bridge 未连接（无法做 EHunt hover）', titles);
  const hoverTargets = urls.slice(0, MAX_LISTINGS_HOVER);
  if (hoverTargets.length === 0) {
    return noData(
      `Etsy 搜索抓到 ${titles.length} 个标题但无可打开的 listing 链接（搜索页结构变化/反爬），无法做 EHunt hover`,
      titles,
    );
  }
  const listings: ListingHoverResult[] = [];
  let ehuntEverDetected = false;
  for (let i = 0; i < hoverTargets.length; i += 1) {
    if (signal.aborted) throw new KeywordAbortError();
    onProgress(i, hoverTargets.length, `EHunt hover：商品 ${i + 1}/${hoverTargets.length}`);
    const r = await extractListingTagPerformance(config, hoverTargets[i], { signal });
    listings.push(r);
    if (r.ehuntDetected) ehuntEverDetected = true;
    // 熔断：前 EHUNT_PROBE_LISTINGS 个全未检测到 → 系统性不可用，快速失败
    // 给清晰原因（带 hover 轨迹），不再磨剩余（每个还有最多 3 次重试）。
    if (!ehuntEverDetected && i + 1 >= EHUNT_PROBE_LISTINGS) {
      onProgress(
        i + 1,
        hoverTargets.length,
        `前 ${EHUNT_PROBE_LISTINGS} 个商品均未检测到 EHunt，跳过本类目剩余 ${hoverTargets.length - i - 1} 个`,
      );
      break;
    }
    if (i < hoverTargets.length - 1) {
      await sleep(LISTING_GAP_MIN_MS + Math.random() * (LISTING_GAP_MAX_MS - LISTING_GAP_MIN_MS), signal);
    }
  }
  onProgress(hoverTargets.length, hoverTargets.length, '分析中');
  return analyzeCategory({ ...meta(t), listings, titles });
}

function meta(t: CatalogTarget) {
  return { categoryId: t.id, categoryName: t.name, categoryPath: t.path, query: t.query };
}

/**
 * 同一 listing 的稳定身份：Etsy URL 里的 `/listing/<id>/`（广告位与自然位
 * 是同一 listing、仅 tracking 参数不同）；无 listing id 时回退去 fragment 的
 * URL；再无则标题。用于样本去重。
 */
export function sampleKey(s: { url?: string; title: string }): string {
  if (s.url) {
    const m = /\/listing\/(\d+)/.exec(s.url);
    return m ? `l:${m[1]}` : `u:${s.url.split('#')[0].toLowerCase()}`;
  }
  return `t:${s.title.trim().toLowerCase()}`;
}

/**
 * 搜索样本去重（保序）。Etsy 搜索页常重复 listing（广告+自然、分页重叠）；
 * 不去重会浪费有限的 EHunt hover 预算，并让同一 listing 的 tag 被当成多个
 * 独立 listing 重复计入 → listingCount 虚高、搜索量中位数失真。
 */
export function dedupeSamples<T extends { url?: string; title: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((s) => {
    const k = sampleKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function runInBackground(
  id: string,
  targets: CatalogTarget[],
  controller: AbortController,
): Promise<void> {
  const store = getKeywordStore();
  // 在 try 外声明：取消/失败时仍能据此保留已完成类目的部分结果。
  const cats: CategoryKeywordResult[] = [];
  try {
    patchKeywordRun(store, id, {
      status: 'running', stage: 'collecting',
      started_at: new Date().toISOString(), progress: 4,
    });

    // 预检 bridge（不阻断：未连接时各类目如实写原因，仍出 Etsy 采集 + 旁证）。
    const settings = getBrowserFetchSettings(store);
    const bridgeProbe = resolveKeywordBridgeConfig(settings.browserContextId);
    const bridgeOk = !!bridgeProbe && settings.enabled;
    const bridgeReason = !settings.enabled
      ? '浏览器抓取被禁用（「选品」→「浏览器抓取 / 反爬」开启）；无法做 EHunt hover'
      : !bridgeProbe
        ? '浏览器 bridge 未连接；无法做 EHunt hover'
        : '';

    for (let i = 0; i < targets.length; i += 1) {
      if (controller.signal.aborted) throw new KeywordAbortError();
      const catBase = i / targets.length;
      const catSpan = 1 / targets.length;
      patchKeywordRun(store, id, {
        stage: 'hovering',
        progress: 4 + Math.round(catBase * 80),
        summary: `类目 ${i + 1}/${targets.length}（${targets[i].name}）· 采集中`,
      });
      cats.push(
        await collectCategory(
          store, targets[i], bridgeOk, bridgeReason, controller.signal,
          (done, total, note) => {
            // 类目内逐 listing 推进，让长 hover 过程进度条不冻结。
            const frac = total > 0 ? done / total : 0;
            patchKeywordRun(store, id, {
              progress: 4 + Math.round((catBase + catSpan * frac) * 80),
              summary: `类目 ${i + 1}/${targets.length}（${targets[i].name}）· ${note}`,
            });
          },
        ),
      );
      patchKeywordRun(store, id, { progress: 4 + Math.round(((i + 1) / targets.length) * 80) });
    }

    if (controller.signal.aborted) throw new KeywordAbortError();
    patchKeywordRun(store, id, { stage: 'composing', progress: 88 });
    const { report, markdown } = composeKeywordReport(cats);
    persistKeywordReport(store, id, report, markdown);

    const okCats = cats.filter((c) => c.ok).length;
    const totalKw = cats.reduce((s, c) => s + c.scoredKeywords.length, 0);
    patchKeywordRun(store, id, {
      status: 'completed', stage: 'done', progress: 100,
      completed_at: new Date().toISOString(),
      summary: okCats === 0
        ? `未产出关键词分析（EHunt 覆盖 ${report.ehuntCoverage.detected}/${report.ehuntCoverage.total}，见报告各类目原因）`
        : `${okCats}/${cats.length} 类目 · ${totalKw} 关键词 · EHunt 覆盖 ${report.ehuntCoverage.detected}/${report.ehuntCoverage.total}`,
    });
  } catch (err) {
    const aborted = err instanceof KeywordAbortError || controller.signal.aborted;
    // 不整批丢弃已完成类目的昂贵 EHunt 成果：能合成部分报告就持久化，
    // 用户停止/失败后仍可查看已完成部分（部分报告失败不掩盖原始错误）。
    if (cats.length > 0) {
      try {
        const { report, markdown } = composeKeywordReport(cats);
        const banner =
          `> ⚠ 本报告为${aborted ? '取消' : '中断'}前的**部分结果**` +
          `（已完成 ${cats.length}/${targets.length} 个类目，其余未采集）。\n\n`;
        persistKeywordReport(store, id, report, banner + markdown);
      } catch {
        /* 部分报告生成失败：忽略，保留原始终态与错误 */
      }
    }
    patchKeywordRun(store, id, {
      status: aborted ? 'cancelled' : 'failed',
      stage: aborted ? 'cancelled' : 'error',
      error: aborted ? '任务被取消' : err instanceof Error ? err.message : String(err),
      completed_at: new Date().toISOString(),
      summary:
        cats.length > 0
          ? `${aborted ? '已取消' : '失败'}·已保留 ${cats.length}/${targets.length} 个类目的部分结果`
          : aborted ? '任务被取消' : '失败',
    });
  } finally {
    unregisterKeywordRun(id);
  }
}

export function getKeywordReportSnapshot(id: string) {
  return getKeywordRun(getKeywordStore(), id);
}
