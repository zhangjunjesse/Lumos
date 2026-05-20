/**
 * 关键词聚合与分析核（纯函数，无 I/O，可单测）。完整 SOP §2.3-2.6：
 * EHunt 逐 tag hover 表现 → 四象限 + 健康度 + 红灯 + 推荐。无降级冒充：
 * EHunt 未就绪的类目不打分、ok:false 带原因。标题 n-gram 仅旁证另列。
 * 报告/Markdown 组织在 keyword-report.ts（交付层，与本分析核解耦）。
 */
import type { ListingHoverResult, TagPerformance } from './keyword-ehunt-hover';
import type {
  CategoryKeywordResult,
  HealthScore,
  Quadrant,
  ScoredKeyword,
} from './keyword-research-types';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'to', 'in', 'on', 'at',
  'by', 'from', 'your', 'you', 'our', 'my', 'this', 'that', 'is', 'are', 'be',
  'it', 'as', 'set', 'pcs', 'pack', 'new', 'free', 'gift', 'gifts', 'custom',
  'personalized', 'handmade', 'unique', 'best', 'sale', 'shop', 'etsy', 'made',
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .map((w) => w.trim()).filter((w) => w.length >= 2 && !/^\d+$/.test(w));
}

export function titleNgrams(title: string): string[] {
  const toks = tokenize(title);
  const out: string[] = [];
  for (let n = 2; n <= 3; n += 1) {
    for (let i = 0; i + n <= toks.length; i += 1) {
      const g = toks.slice(i, i + n);
      if (STOPWORDS.has(g[0]) || STOPWORDS.has(g[g.length - 1])) continue;
      if (g.every((x) => STOPWORDS.has(x))) continue;
      out.push(g.join(' '));
    }
  }
  return out;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function mode<T>(arr: T[], fallback: T): T {
  const c = new Map<T, number>();
  for (const x of arr) c.set(x, (c.get(x) ?? 0) + 1);
  let best = fallback;
  let bn = -1;
  for (const [k, n] of c) if (n > bn) { bn = n; best = k; }
  return best;
}

// 竞争度严重度（unknown 视为最保守一档，与 classify 的「unknown→高」一致）。
const COMP_SEVERITY: Record<TagPerformance['competition'], number> = {
  low: 0, medium: 1, high: 2, unknown: 3,
};

/**
 * 多 listing 竞争度聚合：取众数，但**平票时选更激烈的一档**。
 * 通用 mode 会按插入顺序在平票时选第一个，可能把 ['low','high'] 聚成 'low'
 * → 与本模块「不夸大机会、竞争未知/高不冒充蓝海」的原则相悖。这里保守化。
 */
function aggregateCompetition(
  comps: TagPerformance['competition'][],
): TagPerformance['competition'] {
  if (comps.length === 0) return 'unknown';
  const count = new Map<TagPerformance['competition'], number>();
  for (const c of comps) count.set(c, (count.get(c) ?? 0) + 1);
  let max = 0;
  for (const n of count.values()) if (n > max) max = n;
  let best: TagPerformance['competition'] = 'low';
  let bestSev = -1;
  for (const [c, n] of count) {
    if (n === max && COMP_SEVERITY[c] > bestSev) {
      bestSev = COMP_SEVERITY[c];
      best = c;
    }
  }
  return best;
}

/** 多 listing 的 tag 表现聚合为已解析关键词（搜索量取中位、竞争/趋势取众数）。 */
export function aggregateTagPerformance(listings: ListingHoverResult[]): {
  scored: Omit<ScoredKeyword, 'quadrant'>[];
  ehuntDetected: boolean;
  listingCount: number;
} {
  const ehuntDetected = listings.some((l) => l.ehuntDetected);
  const byTag = new Map<string, { vols: number[]; comps: TagPerformance['competition'][]; compRaws: number[]; trends: TagPerformance['trend'][]; listings: Set<number> }>();
  listings.forEach((l, idx) => {
    for (const t of l.tags) {
      if (!t.parsed || t.searchVolume === null) continue; // 未解析的不进打分池，不造数
      const key = t.tag.trim().toLowerCase();
      if (key.length < 2) continue;
      let e = byTag.get(key);
      if (!e) { e = { vols: [], comps: [], compRaws: [], trends: [], listings: new Set() }; byTag.set(key, e); }
      e.vols.push(t.searchVolume);
      e.comps.push(t.competition);
      if (typeof t.competitionRaw === 'number') e.compRaws.push(t.competitionRaw);
      e.trends.push(t.trend);
      e.listings.add(idx);
    }
  });
  const scored = [...byTag.entries()].map(([keyword, e]) => ({
    keyword,
    searchVolume: median(e.vols),
    competition: aggregateCompetition(e.comps),
    competitionRaw: e.compRaws.length ? median(e.compRaws) : null,
    trend: mode(e.trends, 'unknown' as TagPerformance['trend']),
    listingCount: e.listings.size,
  }));
  return { scored, ehuntDetected, listingCount: listings.length };
}

const EMPTY_QUAD: Record<Quadrant, number> = { blue_ocean: 0, must_have: 0, long_tail: 0, red_ocean: 0 };

function classify(scored: Omit<ScoredKeyword, 'quadrant'>[]): ScoredKeyword[] {
  if (scored.length === 0) return [];
  const volMedian = median(scored.map((s) => s.searchVolume));
  return scored.map((s) => {
    const highVol = s.searchVolume >= volMedian;
    // SOP: Low=低，Medium/High=高。competition 未解析(unknown)时**保守视为高**，
    // 不让"搜索量高+竞争未知"冒充蓝海（诚实，不夸大机会）。
    const highComp = s.competition !== 'low';
    const quadrant: Quadrant = highVol
      ? (highComp ? 'must_have' : 'blue_ocean')
      : (highComp ? 'red_ocean' : 'long_tail');
    return { ...s, quadrant };
  });
}

function health(ks: ScoredKeyword[]): HealthScore {
  const total = ks.length || 1;
  const blue = ks.filter((k) => k.quadrant === 'blue_ocean').length;
  const longTail = ks.filter((k) => k.quadrant === 'long_tail').length;
  const rising = ks.filter((k) => k.trend === 'rising').length;
  const volSorted = [...ks].sort((a, b) => b.searchVolume - a.searchVolume);
  const sumVol = ks.reduce((s, k) => s + k.searchVolume, 0) || 1;
  // 集中度 = 非头部份额。头部 k 随关键词数缩放：n≤3 时若仍取 top3 则
  // topK==全集 → 集中度恒 0，把「关键词少」误判成「被头部垄断」。
  // n≥4 时 k=3，与原口径完全一致（不回归正常类目）。
  const headK = Math.min(3, Math.max(1, ks.length - 1));
  const headVol = volSorted.slice(0, headK).reduce((s, k) => s + k.searchVolume, 0);
  const blueOceanScore = Math.round((blue / total) * 30);
  const concentrationScore = Math.round((1 - headVol / sumVol) * 30);
  const trendScore = Math.round((rising / total) * 20);
  const longTailScore = Math.round((longTail / total) * 20);
  const t = blueOceanScore + concentrationScore + trendScore + longTailScore;
  const grade = t >= 80 ? 'A' : t >= 60 ? 'B' : t >= 40 ? 'C' : 'D';
  return { total: t, grade, blueOceanScore, concentrationScore, trendScore, longTailScore };
}

function redLight(ks: ScoredKeyword[]): { red: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const blue = ks.filter((k) => k.quadrant === 'blue_ocean').length;
  if (blue === 0) reasons.push('蓝海词数量 = 0（无低竞争切入点）');
  const sumVol = ks.reduce((s, k) => s + k.searchVolume, 0);
  if (sumVol < 500) reasons.push(`关键词月搜索量之和 ${sumVol} < 500（需求存疑）`);
  const top3 = [...ks].sort((a, b) => b.searchVolume - a.searchVolume).slice(0, 3);
  if (top3.length >= 3 && top3.every((k) => k.competition === 'high')) {
    reasons.push('头部 3 词竞争度全为「高」（SEO 被头部垄断）');
  }
  return { red: reasons.length > 0, reasons };
}

export interface AnalyzeCategoryInput {
  categoryId: string;
  categoryName: string;
  categoryPath: string[];
  query: string;
  listings: ListingHoverResult[];
  titles: string[];
}

export function analyzeCategory(input: AnalyzeCategoryInput): CategoryKeywordResult {
  const agg = aggregateTagPerformance(input.listings);
  const titleMap = new Map<string, Set<number>>();
  input.titles.forEach((t, i) => {
    for (const g of titleNgrams(t)) {
      let s = titleMap.get(g);
      if (!s) { s = new Set(); titleMap.set(g, s); }
      s.add(i);
    }
  });
  const supplemental = [...titleMap.entries()]
    .map(([keyword, s]) => ({ keyword, listingCount: s.size }))
    .filter((k) => k.listingCount >= 2)
    .sort((a, b) => b.listingCount - a.listingCount)
    .slice(0, 30);

  const base = {
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    categoryPath: input.categoryPath,
    query: input.query,
    ehuntDetected: agg.ehuntDetected,
    listingCount: agg.listingCount,
    supplementalTitleCandidates: supplemental,
  };

  if (!agg.ehuntDetected || agg.scored.length === 0) {
    // 透出代表性 hover 失败原因（没登录/没 tag/解析不到，处理各异）。
    const sampleReason = input.listings.find((l) => l.reason)?.reason;
    // EHunt 检测到却没解析出 → 收集 `[tag] raw` 去重原样回报告供调解析器。
    const rawSamples: string[] = [];
    let emptyRaw = 0;
    let tagTotal = 0;
    for (const l of input.listings) {
      for (const t of l.tags) {
        tagTotal += 1;
        const r = (t.raw || '').trim();
        if (r) rawSamples.push(`[${t.tag}] ${r}`);
        else emptyRaw += 1;
      }
    }
    let ehuntRawSamples = [...new Set(rawSamples)].slice(0, 12);
    // 全空但有 DOM 探针 → 用真实注入结构快照填充（同一报告代码块通路）。
    const domProbes = [
      ...new Set(input.listings.map((l) => l.domProbe || '').filter(Boolean)),
    ].slice(0, 3);
    const usingProbe = ehuntRawSamples.length === 0 && domProbes.length > 0;
    if (usingProbe) ehuntRawSamples = domProbes;
    const detail = !agg.ehuntDetected
      ? ''
      : rawSamples.length
        ? `——已附 ${ehuntRawSamples.length} 条 hover 浮窗原始文本（见下方），按真实 EHunt 结构调解析器`
        : usingProbe
          ? `——${tagTotal} 个 tag hover 均无浮窗，已附 EHunt 真实注入 DOM 快照（见下方），据此调选择器`
          : `——${tagTotal} 个 tag 全部未捕获到浮窗文本（hover 触发方式 / 浮窗选择器需按真机调，${emptyRaw} 个空）`;
    const reason = !agg.ehuntDetected
      ? `EHunt 未就绪/未检测到（请到「选品」标签页的「浏览器抓取 / 反爬」选 AdsPower 上下文并登录 EHunt 付费账号；非降级，不伪造数据）${sampleReason ? `。诊断：${sampleReason}` : ''}`
      : `EHunt 已检测到但本批 ${input.listings.length} 个 listing 未解析出可用 tag 表现${sampleReason ? `（诊断：${sampleReason}）` : ''}${detail}`;
    return {
      ...base, ok: false, reason,
      scoredKeywords: [], quadrantDist: { ...EMPTY_QUAD },
      health: null, redLight: false, redLightReasons: [],
      recommendation: '本类目未产出关键词分析。' + reason,
      ...(agg.ehuntDetected && ehuntRawSamples.length ? { ehuntRawSamples } : {}),
    };
  }

  // EHunt Competition 是裸数值 → 按类目内中位数分 low/high（对齐 SOP 的
  // 搜索量中位分界；类目内相对判定，不凭空设阈值、不伪造）。
  const rawComps = agg.scored
    .map((s) => s.competitionRaw)
    .filter((n): n is number => typeof n === 'number');
  if (rawComps.length > 0) {
    const compMedian = median(rawComps);
    for (const s of agg.scored) {
      if (typeof s.competitionRaw === 'number') {
        s.competition = s.competitionRaw < compMedian ? 'low' : 'high';
      }
    }
  }
  const classified = classify(agg.scored);
  // competition 全 unknown（hover 全失败）→ 强行套四象限得伪结论，降级清单。
  const compKnown = classified.some((k) => k.competition !== 'unknown');
  if (!compKnown) {
    const ranked = [...classified].sort((a, b) => b.searchVolume - a.searchVolume);
    return {
      ...base,
      ok: true,
      scoredKeywords: ranked,
      quadrantDist: { ...EMPTY_QUAD },
      health: null,
      redLight: false,
      redLightReasons: [],
      recommendation:
        `已取 ${ranked.length} 个关键词，按 EHunt 值降序。EHunt 内联标签视图` +
        `只提供单一热度/搜索量值，未提供竞争度/趋势，故不做四象限/健康度/` +
        `红灯判定（避免数据缺失下的伪结论，不伪造）。竞争度需 EHunt` +
        `「Batch Analysis」富视图，本模块未接入。`,
    };
  }

  const scored = classified.sort(
    (a, b) => (a.quadrant === 'blue_ocean' ? -1 : 0) - (b.quadrant === 'blue_ocean' ? -1 : 0) || b.searchVolume - a.searchVolume,
  );
  const quadrantDist = { ...EMPTY_QUAD };
  for (const k of scored) quadrantDist[k.quadrant] += 1;
  const h = health(scored);
  const rl = redLight(scored);
  const blueTop = scored.filter((k) => k.quadrant === 'blue_ocean').slice(0, 5).map((k) => k.keyword);
  const recommendation =
    `健康度 ${h.total}/100（${h.grade}）。蓝海词 ${quadrantDist.blue_ocean} 个` +
    (blueTop.length ? `（如 ${blueTop.join('、')}）` : '') +
    `，必争 ${quadrantDist.must_have}、长尾 ${quadrantDist.long_tail}、红海 ${quadrantDist.red_ocean}。` +
    (rl.red ? ` ⚠ 关键词红灯：${rl.reasons.join('；')}。建议谨慎或换细分。` : ' 可优先用蓝海词去「选品」继续。');

  return {
    ...base, ok: true,
    scoredKeywords: scored, quadrantDist,
    health: h, redLight: rl.red, redLightReasons: rl.reasons,
    recommendation,
  };
}
