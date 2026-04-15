import type { AdapterContext } from '../adapter-types';
import { ctextAdapter } from '../adapters/ctext';

function createContextWithResponses(responses: string[]): AdapterContext {
  let index = 0;
  return {
    fetch: jest.fn(async () => {
      const html = responses[index++];
      return {
        status: 200,
        html,
        contentType: html.trim().startsWith('{') ? 'application/json' : 'text/html',
      };
    }),
    browserCapture: jest.fn(),
    siteEvaluate: jest.fn(),
  };
}

describe('ctext adapter', () => {
  test('parses title search results from HTML', async () => {
    const ctx = createContextWithResponses([`
      <ul class="searchres">
        <li>
          <div class="ctext booksearchresult">
            <b><a class="popup" href="confucianism/zh#n1081">儒家</a></b> ->
            <b><a class="popup" href="analects/zh">論語</a></b>
          </div>
          <span style="font-weight: bold;"></span><br />支持全文檢索的中文文字版。
        </li>
        <li>
          <div class="ctext booksearchresult">
            <a href="https://ctext.org/wiki.pl?if=gb&amp;res=2068596">論語正義</a>
          </div>
          <span style="font-weight: bold;">（清）劉寶楠</span><br />維基文字版：開放共同編輯的資料。
        </li>
      </ul>
    `]);

    const result = await ctextAdapter.search(ctx, '論語', 5);

    expect(result.items).toEqual([
      {
        url: 'https://ctext.org/analects/zh',
        title: '論語',
        snippet: '支持全文檢索的中文文字版。',
        extra: undefined,
      },
      {
        url: 'https://ctext.org/wiki.pl?if=gb&res=2068596',
        title: '論語正義',
        snippet: '（清）劉寶楠 | 維基文字版：開放共同編輯的資料。',
        extra: { author: '（清）劉寶楠' },
      },
    ]);
    expect(result.structuredData).toMatchObject({
      adapter: 'ctext',
      pageType: 'title_search',
      resultCount: 2,
    });
  });

  test('extracts full text through readlink and gettext', async () => {
    const ctx = createContextWithResponses([
      JSON.stringify({ urn: 'ctp:analects' }),
      JSON.stringify({ title: '論語', subsections: ['ctp:analects/xue-er', 'ctp:analects/wei-zheng'] }),
      JSON.stringify({ title: '學而', fulltext: ['學而第一段', '學而第二段'] }),
      JSON.stringify({ title: '為政', fulltext: ['為政第一段'] }),
    ]);

    const result = await ctextAdapter.extract(ctx, 'https://ctext.org/analects/zh');

    expect(result.title).toBe('論語');
    expect(result.contentText).toContain('标题：論語');
    expect(result.contentText).toContain('學而');
    expect(result.contentText).toContain('為政第一段');
    expect(result.contentState).toBe('partial');
    expect(result.structuredData).toMatchObject({
      adapter: 'ctext',
      pageType: 'text_detail',
      urn: 'ctp:analects',
      subsectionCount: 2,
    });
  });

  test('treats ctext as login-free', async () => {
    const probe = await ctextAdapter.probeLogin(createContextWithResponses([]), {
      baseUrl: 'https://ctext.org/',
    });
    expect(probe).toEqual({
      siteKey: 'ctext',
      loginState: 'connected',
      blockingReason: '',
      lastError: '',
    });
  });
});
