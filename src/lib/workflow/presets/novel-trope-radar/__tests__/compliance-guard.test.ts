import {
  validateRunParams,
  assertRunParamsValid,
  assertNoVerbatimChunk,
  isCorpusCollection,
  isManagedCollection,
} from '../compliance-guard';
import {
  DEFAULT_RUN_PARAMS,
  KB_COLLECTION_NAMES,
  RUN_PARAMS_BOUNDS,
} from '../types';

describe('compliance-guard / validateRunParams', () => {
  test('全空对象走默认值', () => {
    const r = validateRunParams({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.platforms).toEqual(DEFAULT_RUN_PARAMS.platforms);
      expect(r.value.topN).toBe(DEFAULT_RUN_PARAMS.topN);
      expect(r.value.cron).toBe(DEFAULT_RUN_PARAMS.cron);
    }
  });

  test('topN 上界外报错', () => {
    const r = validateRunParams({ topN: RUN_PARAMS_BOUNDS.topN.max + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('topN'))).toBe(true);
    }
  });

  test('topN 下界外报错', () => {
    const r = validateRunParams({ topN: 0 });
    expect(r.ok).toBe(false);
  });

  test('未知平台被剔除并报错', () => {
    const r = validateRunParams({ platforms: ['fanqie', 'mystery-platform'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('mystery-platform'))).toBe(true);
    }
  });

  test('platforms 全部非法 → 报错', () => {
    const r = validateRunParams({ platforms: ['xxx', 'yyy'] });
    expect(r.ok).toBe(false);
  });

  test('platforms 去重', () => {
    const r = validateRunParams({ platforms: ['fanqie', 'fanqie', 'qidian'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.platforms).toEqual(['fanqie', 'qidian']);
    }
  });

  test('cron 段数错误报错', () => {
    const r = validateRunParams({ cron: '0 9 * *' });
    expect(r.ok).toBe(false);
  });

  test('完整合法参数原样通过', () => {
    const input = {
      platforms: ['fanqie', 'qidian', 'jjwxc'],
      topN: 50,
      freeChapterLimit: 3,
      cron: '0 9 * * 1',
      perBookDelayMs: 2000,
      reviewLimit: 20,
    };
    const r = validateRunParams(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(input);
    }
  });

  test('assertRunParamsValid 抛错时携带所有错误', () => {
    expect(() => assertRunParamsValid({ topN: 200, cron: 'xxx' }))
      .toThrow(/topN[\s\S]*cron|cron[\s\S]*topN/);
  });
});

describe('compliance-guard / assertNoVerbatimChunk', () => {
  test('短 markdown 通过', () => {
    expect(() => assertNoVerbatimChunk('# 周报\n\n本周冒头 5 个套路', 'report')).not.toThrow();
  });

  test('500 字以上连续中文段触发拒绝', () => {
    const longText = '中'.repeat(600);
    expect(() => assertNoVerbatimChunk(longText, 'report'))
      .toThrow(/疑似包含原文长段/);
  });

  test('被换行打断的长段不触发', () => {
    const segment = '中'.repeat(200);
    const broken = `${segment}\n\n${segment}\n\n${segment}`;
    expect(() => assertNoVerbatimChunk(broken, 'report')).not.toThrow();
  });

  test('空字符串无害', () => {
    expect(() => assertNoVerbatimChunk('', 'report')).not.toThrow();
  });
});

describe('compliance-guard / collection 路由', () => {
  test('isCorpusCollection 仅认 corpus', () => {
    expect(isCorpusCollection(KB_COLLECTION_NAMES.corpus)).toBe(true);
    expect(isCorpusCollection(KB_COLLECTION_NAMES.snapshot)).toBe(false);
    expect(isCorpusCollection(KB_COLLECTION_NAMES.report)).toBe(false);
    expect(isCorpusCollection('random')).toBe(false);
  });

  test('isManagedCollection 认三件套', () => {
    expect(isManagedCollection(KB_COLLECTION_NAMES.corpus)).toBe(true);
    expect(isManagedCollection(KB_COLLECTION_NAMES.snapshot)).toBe(true);
    expect(isManagedCollection(KB_COLLECTION_NAMES.report)).toBe(true);
    expect(isManagedCollection('other')).toBe(false);
  });
});
