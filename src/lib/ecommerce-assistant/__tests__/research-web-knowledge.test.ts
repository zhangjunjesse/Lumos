/**
 * research-web-knowledge：SERP 取数改走内置浏览器 bridge 后的行为锁定。
 * 根因回归：原实现服务端裸 fetch DDG 被 403 → 永久零数据。现在浏览器路径
 * 拿到 SERP 才有数据；浏览器未启用/未连接如实 warning，绝不裸 fetch、不伪造。
 */
class FakeBrowserFetchError extends Error {}
const mockFetchViaBrowser = jest.fn();

jest.mock('../browser-fetcher', () => ({
  fetchViaBrowser: (...a: unknown[]) => mockFetchViaBrowser(...a),
  BrowserFetchError: FakeBrowserFetchError,
}));

import { fetchTopicKnowledge } from '../research-web-knowledge';

const enabled = { enabled: true, browserContextId: 'embedded:default' };

const DDG_HTML_2 = `
<div class="result">
  <a class="result__a" href="https://ex.com/a">如何在 Etsy 选品 完整指南</a>
  <a class="result__snippet">从需求验证到定价的选品方法论。</a>
</div>
<div class="result">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fex.com%2Fb">Etsy 蓝海品类盘点</a>
  <a class="result__snippet">2026 年值得做的细分。</a>
</div>`;

describe('fetchTopicKnowledge', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an honest warning (no fetch) when browser fetch is disabled', async () => {
    const out = await fetchTopicKnowledge({ query: '如何选品', browserSettings: { enabled: false, browserContextId: '' } });
    expect(out.items).toEqual([]);
    expect(out.warning).toMatch(/未启用内置浏览器抓取/);
    expect(mockFetchViaBrowser).not.toHaveBeenCalled();
  });

  it('returns an honest warning when browser settings are absent entirely', async () => {
    const out = await fetchTopicKnowledge({ query: '如何选品' });
    expect(out.items).toEqual([]);
    expect(out.warning).toBeTruthy();
    expect(mockFetchViaBrowser).not.toHaveBeenCalled();
  });

  it('parses real SERP items fetched via the browser bridge', async () => {
    mockFetchViaBrowser.mockResolvedValue({ url: 'x', html: DDG_HTML_2 });
    const out = await fetchTopicKnowledge({ query: '如何选品', platform: 'etsy', browserSettings: enabled });

    expect(mockFetchViaBrowser).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetchViaBrowser.mock.calls[0][0] as string;
    expect(calledUrl).toContain('html.duckduckgo.com/html/?q=');
    expect(out.warning).toBeUndefined();
    expect(out.items).toHaveLength(2);
    expect(out.items[0]).toEqual(
      expect.objectContaining({ title: expect.stringContaining('Etsy 选品'), url: 'https://ex.com/a' }),
    );
    expect(out.items[1].url).toBe('https://ex.com/b'); // DDG /l/?uddg= unwrapped
  });

  it('honestly reports a browser-bridge failure instead of faking data', async () => {
    mockFetchViaBrowser.mockRejectedValue(new FakeBrowserFetchError('Browser Bridge 未连接'));
    const out = await fetchTopicKnowledge({ query: '如何选品', browserSettings: enabled });
    expect(out.items).toEqual([]);
    expect(out.warning).toMatch(/内置浏览器失败.*Browser Bridge 未连接/);
  });

  it('flags DuckDuckGo anti-bot anomaly pages instead of returning junk', async () => {
    mockFetchViaBrowser.mockResolvedValue({ url: 'x', html: '<div class="anomaly-modal__title">If this error persists</div>' });
    const out = await fetchTopicKnowledge({ query: '如何选品', browserSettings: enabled });
    expect(out.items).toEqual([]);
    expect(out.warning).toMatch(/反爬拦截/);
  });

  it('warns on zero natural results', async () => {
    mockFetchViaBrowser.mockResolvedValue({ url: 'x', html: '<html><body>no results here</body></html>' });
    const out = await fetchTopicKnowledge({ query: '如何选品', browserSettings: enabled });
    expect(out.items).toEqual([]);
    expect(out.warning).toMatch(/0 条自然结果/);
  });
});
