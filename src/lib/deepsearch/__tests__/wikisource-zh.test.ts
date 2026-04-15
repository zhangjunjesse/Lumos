import type { AdapterContext } from '../adapter-types';
import { wikisourceZhAdapter } from '../adapters/wikisource-zh';

function createContextWithResponses(responses: string[]): AdapterContext {
  let index = 0;
  return {
    fetch: jest.fn(async () => {
      const html = responses[index++];
      return {
        status: 200,
        html,
        contentType: 'application/json',
      };
    }),
    browserCapture: jest.fn(),
    siteEvaluate: jest.fn(),
  };
}

describe('wikisource zh adapter', () => {
  test('searches MediaWiki API and returns normalized items', async () => {
    const ctx = createContextWithResponses([JSON.stringify({
      query: {
        pages: [
          {
            pageid: 11,
            index: 2,
            title: '資治通鑑',
            extract: '通鑑摘录',
            fullurl: 'https://zh.wikisource.org/wiki/%E8%B3%87%E6%B2%BB%E9%80%9A%E9%91%91',
          },
          {
            pageid: 22,
            index: 1,
            title: '史記',
            extract: '太史公曰……',
            fullurl: 'https://zh.wikisource.org/wiki/%E5%8F%B2%E8%A8%98',
          },
        ],
      },
    })]);

    const result = await wikisourceZhAdapter.search(ctx, '史記', 2);

    expect(result.sourceUrl).toContain('Special:Search');
    expect(result.items).toEqual([
      {
        url: 'https://zh.wikisource.org/wiki/%E5%8F%B2%E8%A8%98',
        title: '史記',
        snippet: '太史公曰……',
        extra: { pageId: 22 },
      },
      {
        url: 'https://zh.wikisource.org/wiki/%E8%B3%87%E6%B2%BB%E9%80%9A%E9%91%91',
        title: '資治通鑑',
        snippet: '通鑑摘录',
        extra: { pageId: 11 },
      },
    ]);
    expect(result.structuredData).toMatchObject({
      adapter: 'wikisource_zh',
      pageType: 'search_api',
      resultCount: 2,
    });
  });

  test('extracts machine-readable full text from page url', async () => {
    const ctx = createContextWithResponses([JSON.stringify({
      query: {
        pages: [
          {
            pageid: 22,
            title: '史記',
            fullurl: 'https://zh.wikisource.org/wiki/%E5%8F%B2%E8%A8%98',
            touched: '2026-01-01T00:00:00Z',
            extract: '史記全文第一段。\n\n史記全文第二段。',
          },
        ],
      },
    })]);

    const result = await wikisourceZhAdapter.extract(ctx, 'https://zh.wikisource.org/wiki/%E5%8F%B2%E8%A8%98');

    expect(result.url).toBe('https://zh.wikisource.org/wiki/%E5%8F%B2%E8%A8%98');
    expect(result.title).toBe('史記');
    expect(result.contentText).toContain('标题：史記');
    expect(result.contentText).toContain('史記全文第一段。');
    expect(result.contentState).toBe('partial');
    expect(result.structuredData).toMatchObject({
      adapter: 'wikisource_zh',
      pageType: 'detail',
      pageId: 22,
    });
  });

  test('treats wikisource as login-free', async () => {
    const probe = await wikisourceZhAdapter.probeLogin(createContextWithResponses([]), {
      baseUrl: 'https://zh.wikisource.org/',
    });
    expect(probe).toEqual({
      siteKey: 'wikisource_zh',
      loginState: 'connected',
      blockingReason: '',
      lastError: '',
    });
  });
});
