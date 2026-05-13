import { relativeAge } from '@/lib/douyin-collector/relative-age';

describe('relativeAge', () => {
  let realDateNow: () => number;
  const NOW = Date.parse('2026-05-10T12:00:00Z');

  beforeEach(() => {
    realDateNow = Date.now;
    Date.now = () => NOW;
  });
  afterEach(() => {
    Date.now = realDateNow;
  });

  it('returns "未知" when iso is null / unparseable', () => {
    expect(relativeAge(null)).toEqual({ label: '未知', hours: null });
    expect(relativeAge('not-an-iso')).toEqual({ label: '未知', hours: null });
  });

  it('returns "刚刚" for timestamps in the future or under 60s ago', () => {
    expect(relativeAge(new Date(NOW + 1000).toISOString()).label).toBe('刚刚');
    expect(relativeAge(new Date(NOW - 30_000).toISOString()).label).toBe('刚刚');
  });

  it('formats minutes for [60s, 1h)', () => {
    expect(relativeAge(new Date(NOW - 5 * 60_000).toISOString()).label).toBe('5 分钟前');
    expect(relativeAge(new Date(NOW - 59 * 60_000).toISOString()).label).toBe('59 分钟前');
  });

  it('formats hours for [1h, 48h)', () => {
    expect(relativeAge(new Date(NOW - 2 * 3_600_000).toISOString()).label).toBe('2 小时前');
    expect(relativeAge(new Date(NOW - 47 * 3_600_000).toISOString()).label).toBe('47 小时前');
  });

  it('formats days for >= 48h and < 30 days', () => {
    expect(relativeAge(new Date(NOW - 2 * 24 * 3_600_000).toISOString()).label).toBe('2 天前');
    expect(relativeAge(new Date(NOW - 29 * 24 * 3_600_000).toISOString()).label).toBe('29 天前');
  });

  it('formats months for >= 30 days and < ~1 year (months floor < 12)', () => {
    expect(relativeAge(new Date(NOW - 30 * 24 * 3_600_000).toISOString()).label).toBe('1 个月前');
    expect(relativeAge(new Date(NOW - 90 * 24 * 3_600_000).toISOString()).label).toBe('3 个月前');
    // 11×30=330 days → 11 个月
    expect(relativeAge(new Date(NOW - 330 * 24 * 3_600_000).toISOString()).label).toBe('11 个月前');
  });

  it('formats years for months floor >= 12 (~360+ days)', () => {
    // 360 days / 30 = 12 months → 1 年
    expect(relativeAge(new Date(NOW - 360 * 24 * 3_600_000).toISOString()).label).toBe('1 年前');
    expect(relativeAge(new Date(NOW - 800 * 24 * 3_600_000).toISOString()).label).toBe('2 年前');
  });

  it('hours is computed even for "刚刚" so callers can compare against thresholds', () => {
    const r = relativeAge(new Date(NOW - 30_000).toISOString());
    expect(r.label).toBe('刚刚');
    expect(r.hours).toBeGreaterThanOrEqual(0);
    expect(r.hours).toBeLessThan(0.1); // ~30s
  });
});
