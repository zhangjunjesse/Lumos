/**
 * 锁定 parseTag（bridge 自驱实测的 EHunt hover tooltip 真实原文）：
 *   Views:  total (16.1M)  monthly (2.9M)
 *   Favorites:  total (719.2K)  monthly (2.0K)
 *   Sales:  total (399.3K)  monthly (10.4K)
 *   Competition:  42.4K
 * → searchVolume=Views monthly、competitionRaw=Competition 数值；
 * competition 分档由 analyzeCategory 按类目中位数定，故 parseTag 恒 unknown。
 * 内联兜底：raw 只是 "(16.1M)" 单值（hover 没出 tooltip）→ 仍取 searchVolume。
 */
import { parseTag } from '../keyword-ehunt-hover';

const TIP =
  'Views:   total (16.1M)  monthly (2.9M)\n' +
  'Favorites:   total (719.2K)  monthly (2.0K)\n' +
  'Sales:   total (399.3K)  monthly (10.4K)\n' +
  'Competition:   42.4K';

describe('parseTag — EHunt hover tooltip 真实格式', () => {
  it('takes Views monthly as searchVolume and Competition as competitionRaw', () => {
    const r = parseTag('best mom mug', TIP);
    expect(r.searchVolume).toBe(2_900_000); // Views monthly 2.9M
    expect(r.competitionRaw).toBe(42_400); // Competition 42.4K
    expect(r.competition).toBe('unknown'); // 分档后由 analyzeCategory 定
    expect(r.trend).toBe('unknown');
    expect(r.parsed).toBe(true);
  });

  it('competition with K/M/comma and decimals', () => {
    const mk = (c: string) =>
      parseTag('t', `Views: total (1M) monthly (2K)\nCompetition: ${c}`).competitionRaw;
    expect(mk('301.2K')).toBe(301_200);
    expect(mk('42.4K')).toBe(42_400);
    expect(mk('1,234')).toBe(1_234);
  });

  it('inline single-value fallback (no tooltip): still searchVolume, competitionRaw null', () => {
    const r = parseTag('best mom cup', '(29.3M)');
    expect(r.searchVolume).toBe(29_300_000);
    expect(r.competitionRaw).toBeNull();
    expect(r.parsed).toBe(true);
  });

  it('non-numeric / empty → unparsed, nothing fabricated', () => {
    for (const v of ['', 'N/A', '   ']) {
      const r = parseTag('x', v);
      expect(r.searchVolume).toBeNull();
      expect(r.competitionRaw).toBeNull();
      expect(r.parsed).toBe(false);
    }
  });

  it('keeps tag verbatim', () => {
    expect(parseTag('mothers day gift', TIP).tag).toBe('mothers day gift');
  });
});
