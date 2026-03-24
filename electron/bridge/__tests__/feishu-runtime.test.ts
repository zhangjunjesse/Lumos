import { toFeishuQueryTimestamp } from '../feishu-runtime';

describe('toFeishuQueryTimestamp', () => {
  it('converts millisecond timestamps to second-based query timestamps', () => {
    expect(toFeishuQueryTimestamp(1773761884008)).toBe('1773761884');
  });

  it('preserves second-based timestamps', () => {
    expect(toFeishuQueryTimestamp(1773761884)).toBe('1773761884');
  });

  it('returns 0 for invalid timestamps', () => {
    expect(toFeishuQueryTimestamp(Number.NaN)).toBe('0');
    expect(toFeishuQueryTimestamp(0)).toBe('0');
    expect(toFeishuQueryTimestamp(-1)).toBe('0');
  });
});
