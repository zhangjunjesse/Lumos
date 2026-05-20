/**
 * 交付层回归锁定：报告组织（首跑横幅、类目健康度排名结论、跨类目蓝海词
 * 溯源、单类目不出排名表）。仅重组分析核已算数据，不伪造。
 */
import { analyzeCategory } from '../keyword-extract';
import { composeKeywordReport } from '../keyword-report';
import type { ListingHoverResult, TagPerformance } from '../keyword-ehunt-hover';

function tag(p: Partial<TagPerformance> & { tag: string }): TagPerformance {
  return {
    searchVolume: 1000,
    competition: 'low',
    competitionRaw: null,
    trend: 'stable',
    raw: '',
    parsed: true,
    ...p,
  };
}

function listing(
  url: string,
  ehuntDetected: boolean,
  tags: TagPerformance[],
  domProbe?: string,
): ListingHoverResult {
  return { url, ehuntDetected, tags, domProbe };
}

const base = { categoryId: 'c', categoryName: 'C', categoryPath: ['Root', 'C'], query: 'q', titles: [] };

describe('composeKeywordReport core', () => {
  it('pools blue-ocean across categories deduped by max volume; honest coverage + reasons', () => {
    const okCat = analyzeCategory({
      ...base,
      listings: [
        listing('u', true, [
          tag({ tag: 'shared', searchVolume: 3000, competition: 'low' }),
          tag({ tag: 'lowkw', searchVolume: 100, competition: 'low' }),
        ]),
      ],
    });
    const okCat2 = analyzeCategory({
      ...base,
      categoryId: 'c2',
      categoryPath: ['Root', 'C2'],
      listings: [
        listing('u', true, [
          tag({ tag: 'shared', searchVolume: 9000, competition: 'low' }),
          tag({ tag: 'tiny', searchVolume: 50, competition: 'low' }),
        ]),
      ],
    });
    const badCat = analyzeCategory({
      ...base,
      categoryId: 'c3',
      categoryPath: ['Root', 'C3'],
      listings: [listing('u', false, [])],
    });
    const { report, markdown } = composeKeywordReport([okCat, okCat2, badCat]);
    expect(report.ehuntCoverage).toEqual({ detected: 2, total: 3 });
    const shared = report.pooledBlueOcean.filter((k) => k.keyword === 'shared');
    expect(shared).toHaveLength(1);
    expect(shared[0].searchVolume).toBe(9000);
    // 结构化契约保持稳定：pooledBlueOcean 仍是 ScoredKeyword（无 from 字段）。
    expect(shared[0]).not.toHaveProperty('from');
    expect(markdown).toContain('# 类目 & 关键词调研报告');
    expect(markdown).toContain('Root › C3');
    expect(markdown).toMatch(/⚠/);
    expect(report.schema).toBe('ecommerce-keyword-research/v2');
  });
});

describe('zero-EHunt banner (first-run UX)', () => {
  const meta = { ...base };

  it('all categories EHunt-off → one prominent setup CTA, not N repeats', () => {
    const c1 = analyzeCategory({ ...meta, listings: [listing('u', false, [])] });
    const c2 = analyzeCategory({
      ...meta,
      categoryId: 'c2',
      categoryPath: ['Root', 'C2'],
      listings: [listing('u', false, [])],
    });
    const { report, markdown } = composeKeywordReport([c1, c2]);
    expect(report.ehuntCoverage).toEqual({ detected: 0, total: 2 });
    expect(markdown).toContain('未接入 EHunt');
    // 指引必须指向真实路径（电商应用无"电商设置"tab；配置在「选品」→「浏览器抓取 / 反爬」）
    expect(markdown).toContain('「选品」标签页的「浏览器抓取 / 反爬」');
    expect(markdown).not.toContain('电商设置');
    expect(markdown).toContain('无需逐条排查');
    // 全未就绪 → 无可排名的 ok 类目，不出排名表。
    expect(markdown).not.toContain('## 类目排名');
  });

  it('banner absent once any category has EHunt coverage', () => {
    const ok = analyzeCategory({
      ...meta,
      listings: [listing('u', true, [tag({ tag: 'good', searchVolume: 1000, competition: 'low' })])],
    });
    const bad = analyzeCategory({
      ...meta,
      categoryId: 'c2',
      categoryPath: ['Root', 'C2'],
      listings: [listing('u', false, [])],
    });
    const { markdown } = composeKeywordReport([ok, bad]);
    expect(markdown).not.toContain('未接入 EHunt');
  });
});

describe('ranked category verdict (decision-support deliverable)', () => {
  // HIGH: 6 低竞争上升词 [1000..500] → 健康度 57(C)、无红灯 → 结论「可做」
  const high = analyzeCategory({
    ...base,
    categoryPath: ['Root', 'HIGH'],
    listings: [
      listing('u', true, [
        tag({ tag: 'h1', searchVolume: 1000, competition: 'low', trend: 'rising' }),
        tag({ tag: 'h2', searchVolume: 900, competition: 'low', trend: 'rising' }),
        tag({ tag: 'h3', searchVolume: 800, competition: 'low', trend: 'rising' }),
        tag({ tag: 'h4', searchVolume: 700, competition: 'low', trend: 'rising' }),
        tag({ tag: 'h5', searchVolume: 600, competition: 'low', trend: 'rising' }),
        tag({ tag: 'h6', searchVolume: 500, competition: 'low', trend: 'rising' }),
      ]),
    ],
  });
  // RED: 2 高竞争词 → 蓝海=0 红灯 → 结论「谨慎」+🔴
  const red = analyzeCategory({
    ...base,
    categoryPath: ['Root', 'RED'],
    listings: [
      listing('u', true, [
        tag({ tag: 'r1', searchVolume: 5000, competition: 'high' }),
        tag({ tag: 'r2', searchVolume: 4000, competition: 'high' }),
      ]),
    ],
  });
  const off = analyzeCategory({
    ...base,
    categoryPath: ['Root', 'OFF'],
    listings: [listing('u', false, [])],
  });

  it('emits a ranked table ordered by health desc with derived verdicts', () => {
    const { markdown } = composeKeywordReport([red, high, off]);
    expect(markdown).toContain('## 类目排名（按健康度）');
    // 健康度高的类目排在前（首次出现=排名表行）。
    expect(markdown.indexOf('Root › HIGH')).toBeLessThan(markdown.indexOf('Root › RED'));
    expect(markdown).toContain('可做'); // HIGH grade C 无红灯
    expect(markdown).toContain('谨慎'); // RED 红灯
    expect(markdown).toContain('🔴');
    // 未产出类目不进排名表行，归到尾部一行。
    expect(markdown).toMatch(/未产出（EHunt 未就绪等）：.*Root › OFF/);
  });

  it('single category → no ranking table (the section itself is the report)', () => {
    const { markdown } = composeKeywordReport([high]);
    expect(markdown).not.toContain('## 类目排名');
    expect(markdown).toContain('Root › HIGH');
  });
});

describe('pooled blue-ocean carries source category (actionable hand-off)', () => {
  it('keeps the max-volume occurrence and names its source category', () => {
    const a = analyzeCategory({
      ...base,
      categoryPath: ['Root', 'A'],
      listings: [listing('u', true, [tag({ tag: 'shared', searchVolume: 3000, competition: 'low' })])],
    });
    const b = analyzeCategory({
      ...base,
      categoryId: 'c2',
      categoryPath: ['Root', 'B'],
      listings: [listing('u', true, [tag({ tag: 'shared', searchVolume: 9000, competition: 'low' })])],
    });
    const { markdown } = composeKeywordReport([a, b]);
    expect(markdown).toContain('## 跨类目蓝海词池 Top');
    expect(markdown).toContain('来源类目');
    const poolHeaderIdx = markdown.indexOf('## 跨类目蓝海词池 Top');
    const poolSection = markdown.slice(poolHeaderIdx);
    // 该词保留 9000（来自 B），来源列写 Root › B。
    expect(poolSection).toMatch(/\| shared \| 9000 \|.*\| Root › B \|/);
  });
});

describe('scraped tag text never breaks the GFM table (cell escaping)', () => {
  it('escapes pipes and collapses newlines in keyword cells', () => {
    // EHunt hover 抓到的 tag 含管道符与换行（页面任意文本）。
    const c = analyzeCategory({
      ...base,
      categoryPath: ['Root', 'X'],
      listings: [
        listing('u', true, [
          tag({ tag: 'Bo|ho\nArt', searchVolume: 1200, competition: 'low' }),
          tag({ tag: 'clean tag', searchVolume: 800, competition: 'low' }),
        ]),
      ],
    });
    const { markdown } = composeKeywordReport([c]);
    // 表格行：管道符按 GFM 转义为 \|、换行折成空格、单元格分隔正确（同一行）。
    // 这一条同时锁定"转义有效"+"列不被多切"+"无裸换行撕行"三件事。
    expect(markdown).toContain('| bo\\|ho art | 1200 |');
    // 任何表格单元格都不得是未转义的原始管道形态（否则 GFM 多切一列）。
    expect(markdown).not.toMatch(/\| bo\|ho/);
  });
});

describe('竞争度全 unknown（EHunt 内联常态）→ 不出四象限/健康度伪结论', () => {
  it('volume-only: ok 但 health=null，报告给 EHunt 值清单 + 显式说明，无健康度/红灯/象限', () => {
    const c = analyzeCategory({
      ...base,
      categoryPath: ['Root', 'V'],
      listings: [
        listing('u1', true, [
          tag({ tag: 'best mom mug', searchVolume: 16_100_000, competition: 'unknown', trend: 'unknown' }),
          tag({ tag: 'mom gift', searchVolume: 49_900_000, competition: 'unknown', trend: 'unknown' }),
        ]),
      ],
    });
    expect(c.ok).toBe(true);
    expect(c.health).toBeNull();
    expect(c.redLight).toBe(false);
    expect(c.scoredKeywords.length).toBe(2);
    // 按 EHunt 值降序
    expect(c.scoredKeywords[0].keyword).toBe('mom gift');
    const { markdown } = composeKeywordReport([c]);
    expect(markdown).toContain('| 关键词 | EHunt 值 | 商品数 |');
    expect(markdown).toContain('不做四象限/健康度/红灯');
    // 不得出现伪造的判定
    expect(markdown).not.toContain('健康度 **');
    expect(markdown).not.toContain('🔴 关键词红灯');
    expect(markdown).not.toMatch(/蓝海 \d+ · 必争/);
  });
});

describe('EHunt 检测到但解析失败 → 原样附浮窗 raw（让"发开发者"落地）', () => {
  it('surfaces captured raw tooltip text in a fenced code block', () => {
    const c = analyzeCategory({
      ...base,
      categoryPath: ['Root', 'Z'],
      listings: [
        // EHunt 检测到，但 hover 抓到的浮窗文本没被 parseTag 解析出来。
        listing('u', true, [
          tag({
            tag: 'macrame wall hanging',
            parsed: false,
            searchVolume: null,
            raw: 'Searches 1,234 ·· Competition: tricky-label 趋势↑',
          }),
        ]),
      ],
    });
    expect(c.ok).toBe(false);
    expect(c.ehuntRawSamples?.length).toBeGreaterThan(0);
    const { markdown } = composeKeywordReport([c]);
    // 报告必须含代码块且原样保留 raw（开发者据此调解析器）。
    expect(markdown).toContain('```text');
    expect(markdown).toContain(
      '[macrame wall hanging] Searches 1,234 ·· Competition: tricky-label 趋势↑',
    );
  });
});

describe('hover 全无浮窗 → 回传 EHunt 真实注入 DOM 快照（据真机调选择器）', () => {
  it('surfaces domProbe in the report code block when all tags empty', () => {
    const probe =
      'EHUNT_EL <DIV class="ehunt-panel">\n<div>Searches 1.2k</div>\n---\nSIGNAL_LINES(2):\nEstimated search 1,234\nCompetition Low';
    const c = analyzeCategory({
      ...base,
      categoryPath: ['Root', 'P'],
      listings: [
        listing(
          'u',
          true,
          [tag({ tag: 'name necklace', parsed: false, searchVolume: null, raw: '' })],
          probe,
        ),
      ],
    });
    expect(c.ok).toBe(false);
    expect(c.ehuntRawSamples).toEqual([probe]);
    const { markdown } = composeKeywordReport([c]);
    expect(markdown).toContain('```text');
    expect(markdown).toContain('EHUNT_EL <DIV class="ehunt-panel">');
    expect(markdown).toContain('Estimated search 1,234');
    expect(markdown).toContain('真实注入 DOM 快照');
  });
});

describe('多行 reason 不撕裂报告（iter19 诊断/CDP 错误原文常多行）', () => {
  it('collapses newlines so the whole reason stays on the ⚠ bullet', () => {
    const c = analyzeCategory({ ...base, categoryPath: ['Root', 'Y'], listings: [] });
    // 模拟 runner 注入的失败 reason：CDP 多行错误 + iter19 hover 轨迹。
    const withReason = {
      ...c,
      reason:
        'EHunt 提取失败：Protocol error\n  at ExecutionContext\n〔轨迹：打开页面 → evaluate 第1次失败〕',
    };
    const { markdown } = composeKeywordReport([withReason]);
    const lines = markdown.split('\n');
    const bullet = lines.find((l) => l.startsWith('- ⚠'));
    expect(bullet).toBeDefined();
    // 整条 reason 折叠到这一条 bullet 内（单行，不被换行撕开）。
    expect(bullet).toContain('Protocol error');
    expect(bullet).toContain('at ExecutionContext');
    expect(bullet).toContain('〔轨迹：打开页面 → evaluate 第1次失败〕');
    // 不得有换行后被撕出来的游离残段。
    expect(lines.some((l) => l.trim() === 'at ExecutionContext')).toBe(false);
  });
});
