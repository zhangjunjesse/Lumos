/**
 * 仅锁定 runner 的**纯**去重身份逻辑（编排是 fire-and-forget，按项目惯例不
 * 单测）。重复 listing 不去重会浪费 EHunt hover 预算并让 listingCount/中位数
 * 失真——这条身份规则一旦回归会静默污染打分数据，故锁定。
 */
import { sampleKey, dedupeSamples } from '../keyword-research-runner';

describe('sampleKey — stable listing identity', () => {
  it('keys by Etsy /listing/<id>/ regardless of tracking params', () => {
    const a = sampleKey({
      url: 'https://www.etsy.com/listing/12345/boho-wall-art?click_key=x&ref=ad',
      title: 'Boho Wall Art',
    });
    const b = sampleKey({
      url: 'https://www.etsy.com/listing/12345/boho-wall-art?ref=organic',
      title: 'Boho Wall Art (dup placement)',
    });
    expect(a).toBe('l:12345');
    expect(a).toBe(b); // 同一 listing 的广告位与自然位 → 同 key
  });

  it('falls back to fragment-stripped url, then title', () => {
    expect(sampleKey({ url: 'https://x.com/p/abc#frag', title: 'T' })).toBe(
      'u:https://x.com/p/abc',
    );
    expect(sampleKey({ title: '  Mixed Case Title  ' })).toBe('t:mixed case title');
  });
});

describe('dedupeSamples — order-preserving, identity-based', () => {
  it('drops duplicate listings (keeps first), preserves order', () => {
    const rows = [
      { url: 'https://www.etsy.com/listing/1/a?ref=a', title: 'A' },
      { url: 'https://www.etsy.com/listing/2/b', title: 'B' },
      { url: 'https://www.etsy.com/listing/1/a?ref=ad', title: 'A dup' }, // 同 listing 1
      { title: 'C' },
      { title: 'c' }, // 标题大小写归一 → 与上一条同 key
    ];
    const out = dedupeSamples(rows);
    expect(out.map((r) => r.title)).toEqual(['A', 'B', 'C']);
  });

  it('returns [] for [] and keeps all when already unique', () => {
    expect(dedupeSamples([])).toEqual([]);
    const uniq = [
      { url: 'https://www.etsy.com/listing/1/a', title: 'A' },
      { url: 'https://www.etsy.com/listing/2/b', title: 'B' },
    ];
    expect(dedupeSamples(uniq)).toHaveLength(2);
  });
});
