import { computeTrendDiff } from '../trend-differ';
import type { PlatformKey, TropeRecord } from '../types';

function make(
  bookKey: string,
  platform: PlatformKey,
  tropeTags: string[],
  openingHookType = 'generic',
): TropeRecord {
  return {
    bookKey,
    platform,
    weekId: '2026-W18',
    rank: 1,
    title: 'fixture',
    author: 'a',
    category: 'c',
    tags: [],
    genre: 'g',
    goldenFinger: 'system',
    openingHookType,
    protagonistArchetype: 'p',
    pacing: 'every-3',
    antagonistType: 'rival',
    tropeTags,
    readerPainPoints: [],
    readerHighPoints: [],
    freeChapterRefs: [],
  };
}

describe('computeTrendDiff', () => {
  test('rising 阈值 ≥3 才入榜', () => {
    const thisWeek = [
      make('a:1', 'fanqie', ['系统', '重生']),
      make('a:2', 'fanqie', ['系统']),
      make('a:3', 'fanqie', ['系统']),
      make('a:4', 'fanqie', ['系统']),
    ];
    const lastWeek = [
      make('a:99', 'fanqie', ['系统']),
    ];
    const diff = computeTrendDiff(thisWeek, lastWeek);
    expect(diff.risingTropes.find((t) => t.tag === '系统')?.thisWeek).toBe(4);
    expect(diff.risingTropes.find((t) => t.tag === '系统')?.lastWeek).toBe(1);
  });

  test('Δ<3 的 tag 不入冒头榜', () => {
    const thisWeek = [
      make('a:1', 'fanqie', ['团宠']),
      make('a:2', 'fanqie', ['团宠']),
    ];
    const lastWeek = [
      make('a:99', 'fanqie', ['团宠']),
    ];
    const diff = computeTrendDiff(thisWeek, lastWeek);
    expect(diff.risingTropes.find((t) => t.tag === '团宠')).toBeUndefined();
  });

  test('declining 取上周 - 本周 ≥ 3', () => {
    const thisWeek = [make('a:1', 'fanqie', ['退潮'])];
    const lastWeek = [
      make('a:1', 'fanqie', ['退潮']),
      make('a:2', 'fanqie', ['退潮']),
      make('a:3', 'fanqie', ['退潮']),
      make('a:4', 'fanqie', ['退潮']),
      make('a:5', 'fanqie', ['退潮']),
    ];
    const diff = computeTrendDiff(thisWeek, lastWeek);
    expect(diff.decliningTropes[0]?.tag).toBe('退潮');
    expect(diff.decliningTropes[0]?.thisWeek).toBe(1);
    expect(diff.decliningTropes[0]?.lastWeek).toBe(5);
  });

  test('newCombinations 检测新组合 (本周出现且 ≥2 本)', () => {
    const thisWeek = [
      make('a:1', 'fanqie', ['系统', '末世']),
      make('a:2', 'fanqie', ['系统', '末世']),
    ];
    const lastWeek = [
      make('b:1', 'fanqie', ['系统']),
    ];
    const diff = computeTrendDiff(thisWeek, lastWeek);
    expect(diff.newCombinations).toContainEqual(
      expect.objectContaining({
        a: expect.any(String),
        b: expect.any(String),
      }),
    );
    const combo = diff.newCombinations[0];
    expect([combo.a, combo.b].sort()).toEqual(['末世', '系统']);
  });

  test('crossPlatformSpread 检测 tag 蔓延到新平台', () => {
    const thisWeek = [
      make('a:1', 'fanqie', ['系统']),
      make('b:1', 'qidian', ['系统']),
    ];
    const lastWeek = [
      make('a:1', 'fanqie', ['系统']),
    ];
    const diff = computeTrendDiff(thisWeek, lastWeek);
    expect(diff.crossPlatformSpread.find((t) => t.tag === '系统')).toBeDefined();
    expect(diff.crossPlatformSpread.find((t) => t.tag === '系统')?.to).toContain('qidian');
  });

  test('hookPatternArchive 按 count desc', () => {
    const records = [
      make('a:1', 'fanqie', [], '退婚-逆袭'),
      make('a:2', 'fanqie', [], '退婚-逆袭'),
      make('a:3', 'fanqie', [], '退婚-逆袭'),
      make('a:4', 'fanqie', [], '系统觉醒'),
    ];
    const diff = computeTrendDiff(records, []);
    expect(diff.hookPatternArchive[0].pattern).toBe('退婚-逆袭');
    expect(diff.hookPatternArchive[0].count).toBe(3);
  });

  test('上周空 → declining 也空,rising 仍按 Δ≥3 计', () => {
    const thisWeek = [
      make('a:1', 'fanqie', ['x']),
      make('a:2', 'fanqie', ['x']),
      make('a:3', 'fanqie', ['x']),
      make('a:4', 'fanqie', ['x']),
    ];
    const diff = computeTrendDiff(thisWeek, []);
    expect(diff.decliningTropes).toEqual([]);
    expect(diff.risingTropes[0].tag).toBe('x');
    expect(diff.risingTropes[0].lastWeek).toBe(0);
  });
});
