/**
 * 类目&关键词调研 —— 报告/交付层（与 keyword-extract 分析核解耦）。
 *
 * 单一职责：把已分析的 CategoryKeywordResult[] 组织成**决策支持**报告——
 * 顶部先给"该做哪些类目"的健康度排名结论，再列每类目明细，最后跨类目蓝海
 * 词池（带来源类目，让结论可直接落到「选品」）。仅重组已算数据，不伪造。
 */
import type {
  CategoryKeywordResult,
  KeywordResearchReport,
  Quadrant,
  ScoredKeyword,
} from './keyword-research-types';

function quadLabel(q: Quadrant): string {
  return q === 'blue_ocean'
    ? '蓝海'
    : q === 'must_have'
      ? '必争'
      : q === 'long_tail'
        ? '长尾'
        : '红海';
}

/**
 * GFM 表格单元格转义：EHunt hover 抓来的 tag 是任意页面文本，可能含 `|`
 * 或换行——直接拼进 `| ... |` 会撕裂整张表。这里在**展示边界**转义（不改
 * 结构化数据，保持"不伪造"）：换行折成空格、管道符按 GFM 写成 `\|`。
 */
function cell(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').trim();
}

/** 由健康度 + 红灯派生的一词结论（诚实：纯函数式映射，不夸大）。 */
function verdict(c: CategoryKeywordResult): string {
  if (!c.ok || !c.health) return '未产出';
  if (c.redLight) return '谨慎';
  return c.health.grade === 'A'
    ? '优先'
    : c.health.grade === 'B'
      ? '推荐'
      : c.health.grade === 'C'
        ? '可做'
        : '观望';
}

/** ok 类目按健康度降序（并列：蓝海词多者先，再按路径稳定排序）。 */
function rankOk(cats: CategoryKeywordResult[]): CategoryKeywordResult[] {
  return cats
    .filter((c) => c.ok && c.health)
    .sort(
      (a, b) =>
        b.health!.total - a.health!.total ||
        b.quadrantDist.blue_ocean - a.quadrantDist.blue_ocean ||
        a.categoryPath.join('/').localeCompare(b.categoryPath.join('/')),
    );
}

interface PooledEntry {
  k: ScoredKeyword;
  from: string;
}

/** 跨类目蓝海词去重：同词保留搜索量最大的那次，并记录其来源类目。 */
function poolBlueOcean(cats: CategoryKeywordResult[]): PooledEntry[] {
  const poolMap = new Map<string, PooledEntry>();
  for (const c of cats) {
    const from = c.categoryPath.join(' › ');
    for (const k of c.scoredKeywords) {
      if (k.quadrant !== 'blue_ocean') continue;
      const e = poolMap.get(k.keyword);
      if (!e || k.searchVolume > e.k.searchVolume) poolMap.set(k.keyword, { k, from });
    }
  }
  return [...poolMap.values()]
    .sort((a, b) => b.k.searchVolume - a.k.searchVolume)
    .slice(0, 40);
}

const DATA_BASIS =
  '数据：内置浏览器在 EHunt 所在上下文打开 Etsy listing，逐 tag hover 抓 EHunt 浮窗（搜索量/竞争度/趋势）。' +
  '关键词=listing 标签（tags=关键词=SEO 词）。EHunt 未就绪的类目不打分、如实标原因，不伪造。';

function rankedSummary(cats: CategoryKeywordResult[]): string[] {
  const ok = rankOk(cats);
  if (ok.length === 0 || cats.length < 2) return [];
  const L: string[] = ['## 类目排名（按健康度）', ''];
  L.push('| 类目 | 结论 | 健康度 | 蓝海/必争/长尾/红海 | 红灯 |');
  L.push('|---|---|--:|---|---|');
  for (const c of ok) {
    const q = c.quadrantDist;
    L.push(
      `| ${c.categoryPath.join(' › ')} | ${verdict(c)} | ${c.health!.total} (${c.health!.grade}) ` +
        `| ${q.blue_ocean}/${q.must_have}/${q.long_tail}/${q.red_ocean} | ${c.redLight ? '🔴' : '—'} |`,
    );
  }
  const notOk = cats.filter((c) => !c.ok);
  if (notOk.length > 0) {
    L.push('');
    L.push(`> 未产出（EHunt 未就绪等）：${notOk.map((c) => c.categoryPath.join(' › ')).join('、')}`);
  }
  L.push('');
  return L;
}

export function composeKeywordReport(cats: CategoryKeywordResult[]): {
  report: KeywordResearchReport;
  markdown: string;
} {
  const detected = cats.filter((c) => c.ehuntDetected).length;
  const pooled = poolBlueOcean(cats);

  const report: KeywordResearchReport = {
    schema: 'ecommerce-keyword-research/v2',
    generatedAt: new Date().toISOString(),
    dataBasis: DATA_BASIS,
    categories: cats,
    pooledBlueOcean: pooled.map((p) => p.k),
    ehuntCoverage: { detected, total: cats.length },
    notes: [
      `EHunt 覆盖：${detected}/${cats.length} 个类目检测到。未检测到的类目需到「选品」标签页的「浏览器抓取 / 反爬」选 AdsPower 上下文并登录 EHunt 后重跑。`,
      '四象限按 SOP：搜索量分界=类目内中位数；竞争度 Low=低，Medium/High=高。',
      '标题 n-gram 候选仅旁证（无搜索量），与已打分关键词分开，未参与四象限/健康度。',
    ],
  };

  const L: string[] = [];
  L.push('# 类目 & 关键词调研报告');
  L.push('');
  L.push(`> ${DATA_BASIS}`);
  L.push('');
  L.push(`**EHunt 覆盖**：${detected}/${cats.length} 类目`);
  L.push('');
  // 最常见首跑态：EHunt 完全未接入 → 全类目同一根因。单条醒目 CTA 代替 N 段重复。
  if (cats.length > 0 && detected === 0) {
    L.push('> ⚠ **未接入 EHunt — 本次未产出任何关键词分析**');
    L.push('>');
    L.push(
      '> 关键词的搜索量/竞争度依赖 EHunt 浮窗数据。请到「选品」标签页的' +
        '「浏览器抓取 / 反爬」选择 AdsPower 上下文并登录 EHunt 付费账号后重跑。' +
        '下方各类目原因均为同一根因，无需逐条排查。',
    );
    L.push('');
  }
  for (const line of rankedSummary(cats)) L.push(line);

  for (const c of cats) {
    L.push(`## ${c.categoryPath.join(' › ')}`);
    if (!c.ok) {
      // reason 现含 hover 诊断/CDP 错误原文（iter19），后者常多行——
      // 裸插会把这个 bullet 撕开、并入下方表格。复用 cell() 折叠换行。
      L.push(`- ⚠ ${cell(c.reason ?? '未说明原因')}`);
      if (c.supplementalTitleCandidates.length) {
        L.push(
          `- 旁证（标题高频，无搜索量，仅供参考）：${c.supplementalTitleCandidates
            .slice(0, 12)
            .map((k) => k.keyword)
            .join('、')}`,
        );
      }
      L.push('');
      continue;
    }
    const h = c.health!;
    L.push(`- 采样 listing ${c.listingCount} · 已打分关键词 ${c.scoredKeywords.length}`);
    L.push(
      `- 健康度 **${h.total}/100（${h.grade}）** ｜ 蓝海 ${c.quadrantDist.blue_ocean} · 必争 ${c.quadrantDist.must_have} · 长尾 ${c.quadrantDist.long_tail} · 红海 ${c.quadrantDist.red_ocean}`,
    );
    if (c.redLight) L.push(`- 🔴 关键词红灯：${c.redLightReasons.join('；')}`);
    L.push('');
    L.push('| 关键词 | 搜索量 | 竞争度 | 趋势 | 象限 | 商品数 |');
    L.push('|---|--:|---|---|---|--:|');
    for (const k of c.scoredKeywords.slice(0, 30)) {
      L.push(
        `| ${cell(k.keyword)} | ${k.searchVolume} | ${k.competition} | ${k.trend} | ${quadLabel(k.quadrant)} | ${k.listingCount} |`,
      );
    }
    L.push('');
    L.push(`**建议**：${c.recommendation}`);
    if (c.supplementalTitleCandidates.length) {
      L.push('');
      L.push(
        `旁证·标题高频候选（无搜索量）：${c.supplementalTitleCandidates
          .slice(0, 15)
          .map((k) => k.keyword)
          .join('、')}`,
      );
    }
    L.push('');
  }
  if (pooled.length > 0) {
    L.push('## 跨类目蓝海词池 Top');
    L.push('');
    L.push('| 关键词 | 搜索量 | 竞争度 | 趋势 | 来源类目 |');
    L.push('|---|--:|---|---|---|');
    for (const p of pooled.slice(0, 30)) {
      L.push(
        `| ${cell(p.k.keyword)} | ${p.k.searchVolume} | ${p.k.competition} | ${p.k.trend} | ${cell(p.from)} |`,
      );
    }
    L.push('');
  }
  L.push('## 说明');
  for (const n of report.notes) L.push(`- ${n}`);
  return { report, markdown: L.join('\n') };
}
