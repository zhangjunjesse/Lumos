/**
 * 类目&关键词调研 分析核回归锁定（纯函数，无 I/O）。
 * 覆盖：tag 表现聚合（不造数）、四象限分类（竞争未知保守视为高，不冒充蓝海）、
 * 健康度/红灯数学、报告合成（跨类目蓝海词去重 + 诚实标注未就绪类目）。
 */
import {
  aggregateTagPerformance,
  analyzeCategory,
  titleNgrams,
} from '../keyword-extract';
import type {
  ListingHoverResult,
  TagPerformance,
} from '../keyword-ehunt-hover';

function tag(p: Partial<TagPerformance> & { tag: string }): TagPerformance {
  return {
    searchVolume: 1000,
    competition: 'low',
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
  reason?: string,
): ListingHoverResult {
  return { url, ehuntDetected, reason, tags };
}

describe('aggregateTagPerformance', () => {
  it('skips unparsed / null-volume tags and never fabricates data', () => {
    const l1 = listing('a', true, [
      tag({ tag: 'boho', searchVolume: 1000, competition: 'low' }),
      tag({ tag: 'junk', parsed: false, searchVolume: null }),
    ]);
    const l2 = listing('b', false, [
      tag({ tag: 'boho', searchVolume: 2000, competition: 'low' }),
      tag({ tag: 'nullvol', searchVolume: null, parsed: true, competition: 'high' }),
    ]);
    const agg = aggregateTagPerformance([l1, l2]);
    expect(agg.ehuntDetected).toBe(true); // 任一 listing 检测到即 true
    expect(agg.listingCount).toBe(2);
    const boho = agg.scored.find((s) => s.keyword === 'boho');
    expect(boho).toBeTruthy();
    expect(boho!.searchVolume).toBe(1500); // median([1000,2000])
    expect(boho!.listingCount).toBe(2);
    expect(agg.scored.map((s) => s.keyword).sort()).toEqual(['boho']);
  });

  it('ehuntDetected false when no listing detected EHunt', () => {
    const agg = aggregateTagPerformance([listing('a', false, [])]);
    expect(agg.ehuntDetected).toBe(false);
    expect(agg.scored).toEqual([]);
  });
});

describe('analyzeCategory quadrant classification', () => {
  const meta = {
    categoryId: 'c',
    categoryName: 'C',
    categoryPath: ['Root', 'C'],
    query: 'q',
    titles: [],
  };

  it('classifies blue/must/long/red by vol-median × competition', () => {
    const r = analyzeCategory({
      ...meta,
      listings: [
        listing('u', true, [
          tag({ tag: 'aa', searchVolume: 5000, competition: 'low' }),
          tag({ tag: 'bb', searchVolume: 4000, competition: 'high' }),
          tag({ tag: 'cc', searchVolume: 200, competition: 'low' }),
          tag({ tag: 'dd', searchVolume: 100, competition: 'high' }),
        ]),
      ],
    });
    expect(r.ok).toBe(true);
    const q = Object.fromEntries(r.scoredKeywords.map((k) => [k.keyword, k.quadrant]));
    expect(q.aa).toBe('blue_ocean');
    expect(q.bb).toBe('must_have');
    expect(q.cc).toBe('long_tail');
    expect(q.dd).toBe('red_ocean');
    expect(r.quadrantDist).toEqual({
      blue_ocean: 1,
      must_have: 1,
      long_tail: 1,
      red_ocean: 1,
    });
  });

  it('treats unknown competition as HIGH — high search + unknown comp must NOT pose as blue ocean', () => {
    const r = analyzeCategory({
      ...meta,
      listings: [
        listing('u', true, [
          tag({ tag: 'risky', searchVolume: 6000, competition: 'unknown' }),
          tag({ tag: 'tiny', searchVolume: 100, competition: 'low' }),
        ]),
      ],
    });
    const risky = r.scoredKeywords.find((k) => k.keyword === 'risky')!;
    expect(risky.quadrant).toBe('must_have'); // 不得是 blue_ocean
  });

  it('EHunt not detected → ok:false, actionable AdsPower reason, no scoring', () => {
    const r = analyzeCategory({ ...meta, listings: [listing('u', false, [])] });
    expect(r.ok).toBe(false);
    expect(r.scoredKeywords).toEqual([]);
    expect(r.health).toBeNull();
    expect(r.reason).toMatch(/AdsPower/);
    // 指引路径必须真实：电商应用无"电商设置"tab，配置在「选品」→「浏览器抓取 / 反爬」
    expect(r.reason).toContain('选品');
    expect(r.reason).not.toContain('电商设置');
  });

  it('EHunt detected but nothing parsed → ok:false with the "detected-but-unparsed" reason', () => {
    const r = analyzeCategory({
      ...meta,
      listings: [
        listing('u', true, [tag({ tag: 'x', parsed: false, searchVolume: null })], 'raw diag'),
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/已检测到/);
    expect(r.reason).not.toMatch(/AdsPower/);
  });

  it('title n-grams listed separately as supplemental, never mixed into scored pool', () => {
    const r = analyzeCategory({
      ...meta,
      titles: ['boho macrame wall hanging', 'boho macrame wall art'],
      listings: [listing('u', true, [tag({ tag: 'real', searchVolume: 900, competition: 'low' })])],
    });
    expect(r.scoredKeywords.map((k) => k.keyword)).toEqual(['real']);
    expect(r.supplementalTitleCandidates.some((s) => s.keyword === 'boho macrame')).toBe(true);
  });
});

describe('health & red light', () => {
  const meta = { categoryId: 'c', categoryName: 'C', categoryPath: ['C'], query: 'q', titles: [] };

  it('red light: zero blue ocean keywords', () => {
    const r = analyzeCategory({
      ...meta,
      listings: [
        listing('u', true, [
          tag({ tag: 'hh', searchVolume: 5000, competition: 'high' }),
          tag({ tag: 'ii', searchVolume: 4000, competition: 'high' }),
        ]),
      ],
    });
    expect(r.redLight).toBe(true);
    expect(r.redLightReasons.some((x) => /蓝海词数量 = 0/.test(x))).toBe(true);
  });

  it('red light: total search volume sum < 500', () => {
    const r = analyzeCategory({
      ...meta,
      listings: [
        listing('u', true, [
          tag({ tag: 'jj', searchVolume: 100, competition: 'low' }),
          tag({ tag: 'kk', searchVolume: 50, competition: 'low' }),
        ]),
      ],
    });
    expect(r.redLight).toBe(true);
    expect(r.redLightReasons.some((x) => /< 500/.test(x))).toBe(true);
  });

  it('red light: top-3 keywords all high competition', () => {
    const r = analyzeCategory({
      ...meta,
      listings: [
        listing('u', true, [
          tag({ tag: 'pp', searchVolume: 9000, competition: 'high' }),
          tag({ tag: 'qq', searchVolume: 8000, competition: 'high' }),
          tag({ tag: 'rr', searchVolume: 7000, competition: 'high' }),
          tag({ tag: 'ss', searchVolume: 50, competition: 'low' }),
        ]),
      ],
    });
    expect(r.redLightReasons.some((x) => /头部 3 词竞争度全为/.test(x))).toBe(true);
  });

  it('health score is the exact documented formula (locks the rubric)', () => {
    // 6 词全低竞争全上升，量 [1000..500]：中位=750 → 3 蓝海(>=750) + 3 长尾。
    // blue=round(3/6*30)=15 · concentration=round((1-2700/4500)*30)=12
    // trend=round(6/6*20)=20 · longTail=round(3/6*20)=10 · 合计=57 → C
    const r = analyzeCategory({
      ...meta,
      listings: [
        listing('u', true, [
          tag({ tag: 'k1000', searchVolume: 1000, competition: 'low', trend: 'rising' }),
          tag({ tag: 'k900', searchVolume: 900, competition: 'low', trend: 'rising' }),
          tag({ tag: 'k800', searchVolume: 800, competition: 'low', trend: 'rising' }),
          tag({ tag: 'k700', searchVolume: 700, competition: 'low', trend: 'rising' }),
          tag({ tag: 'k600', searchVolume: 600, competition: 'low', trend: 'rising' }),
          tag({ tag: 'k500', searchVolume: 500, competition: 'low', trend: 'rising' }),
        ]),
      ],
    });
    expect(r.health).toEqual({
      total: 57,
      grade: 'C',
      blueOceanScore: 15,
      concentrationScore: 12,
      trendScore: 20,
      longTailScore: 10,
    });
    expect(r.quadrantDist).toEqual({
      blue_ocean: 3,
      must_have: 0,
      long_tail: 3,
      red_ocean: 0,
    });
  });
});

describe('titleNgrams', () => {
  it('emits 2-3grams and drops stopword-edged grams', () => {
    const g = titleNgrams('handmade boho macrame wall hanging for the home');
    expect(g).toContain('boho macrame');
    expect(g).toContain('macrame wall hanging');
    expect(g.every((x) => !x.startsWith('the ') && !x.endsWith(' the'))).toBe(true);
  });
});

describe('concentration scales head-k with keyword count (thin-category fix)', () => {
  const meta = { categoryId: 'c', categoryName: 'C', categoryPath: ['C'], query: 'q', titles: [] };

  it('3 equal strong low-comp rising keywords → not punished as head-monopolized', () => {
    const r = analyzeCategory({
      ...meta,
      listings: [
        listing('u', true, [
          tag({ tag: 'kk1', searchVolume: 1000, competition: 'low', trend: 'rising' }),
          tag({ tag: 'kk2', searchVolume: 1000, competition: 'low', trend: 'rising' }),
          tag({ tag: 'kk3', searchVolume: 1000, competition: 'low', trend: 'rising' }),
        ]),
      ],
    });
    // headK=min(3,n-1)=2 → headVol=2000/3000 → concentration=round(.333*30)=10
    // (旧口径 top3==全集 → 恒 0，总分被压成 50/C；现 60/B 更准确)
    expect(r.health).toEqual({
      total: 60,
      grade: 'B',
      blueOceanScore: 30,
      concentrationScore: 10,
      trendScore: 20,
      longTailScore: 0,
    });
  });

  it('single keyword is still treated as fully concentrated (score 0)', () => {
    const r = analyzeCategory({
      ...meta,
      listings: [
        listing('u', true, [tag({ tag: 'solo', searchVolume: 1000, competition: 'low' })]),
      ],
    });
    expect(r.health!.concentrationScore).toBe(0);
  });
});

describe('aggregateCompetition is conservative on ties (no opportunity inflation)', () => {
  it('low vs high tie across listings resolves to HIGH, not insertion-order low', () => {
    const agg = aggregateTagPerformance([
      listing('a', true, [tag({ tag: 'tied', searchVolume: 1000, competition: 'low' })]),
      listing('b', true, [tag({ tag: 'tied', searchVolume: 1000, competition: 'high' })]),
    ]);
    expect(agg.scored.find((s) => s.keyword === 'tied')!.competition).toBe('high');
  });

  it('clear majority still wins (low,low,high → low)', () => {
    const agg = aggregateTagPerformance([
      listing('a', true, [tag({ tag: 'maj', searchVolume: 1, competition: 'low' })]),
      listing('b', true, [tag({ tag: 'maj', searchVolume: 1, competition: 'low' })]),
      listing('c', true, [tag({ tag: 'maj', searchVolume: 1, competition: 'high' })]),
    ]);
    expect(agg.scored.find((s) => s.keyword === 'maj')!.competition).toBe('low');
  });

  it('medium vs low tie resolves to the more competitive (medium)', () => {
    const agg = aggregateTagPerformance([
      listing('a', true, [tag({ tag: 'mt', searchVolume: 1, competition: 'medium' })]),
      listing('b', true, [tag({ tag: 'mt', searchVolume: 1, competition: 'low' })]),
    ]);
    expect(agg.scored.find((s) => s.keyword === 'mt')!.competition).toBe('medium');
  });
});

