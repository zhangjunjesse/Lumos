import {
  collectDeepSearchFollowUpUrls,
  resolveSiteSeedBindingRole,
  resolveSiteSeedUrl,
} from '../site-routing';

describe('deepsearch site routing', () => {
  test('uses zhihu search page as managed seed url', () => {
    expect(resolveSiteSeedUrl('zhihu', 'https://www.zhihu.com/', '大模型 反爬')).toBe(
      'https://www.zhihu.com/search?type=content&q=%E5%A4%A7%E6%A8%A1%E5%9E%8B%20%E5%8F%8D%E7%88%AC',
    );
  });

  test('falls back to site base url for non zhihu sites or empty query', () => {
    expect(resolveSiteSeedUrl('xiaohongshu', 'https://www.xiaohongshu.com/', '笔记')).toBe(
      'https://www.xiaohongshu.com/',
    );
    expect(resolveSiteSeedUrl('zhihu', 'https://www.zhihu.com/', '   ')).toBe('https://www.zhihu.com/');
  });

  test('marks zhihu managed search seed as search role', () => {
    expect(resolveSiteSeedBindingRole('zhihu', 'deepsearch')).toBe('search');
    expect(resolveSiteSeedBindingRole('zhihu', '   ')).toBe('seed');
    expect(resolveSiteSeedBindingRole('xiaohongshu', 'note')).toBe('seed');
  });

  test('collects top zhihu detail urls including zhuanlan articles', () => {
    const seenUrls = new Set<string>(['https://www.zhihu.com/question/111']);

    const urls = collectDeepSearchFollowUpUrls({
      siteKey: 'zhihu',
      bindingRole: 'search',
      extraction: {
        url: 'https://www.zhihu.com/search?type=content&q=deepsearch',
        title: '知乎搜索',
        lines: [],
        contentText: '',
        contentState: 'list_only',
        snippet: '',
        evidenceCount: 4,
        structuredData: {
          pageType: 'list_page',
          results: [
            { url: 'https://www.zhihu.com/question/111', title: 'duplicate' },
            { url: 'https://zhuanlan.zhihu.com/p/222', title: 'column' },
            { url: 'https://www.zhihu.com/zvideo/333', title: 'video' },
            { url: 'https://www.zhihu.com/question/444?utm_psn=1', title: 'question' },
            { url: 'https://www.zhihu.com/search?type=content&q=ignored', title: 'search page' },
            { url: 'https://example.com/question/555', title: 'external' },
          ],
        },
      },
      seenUrls,
    });

    expect(urls).toEqual([
      'https://zhuanlan.zhihu.com/p/222',
      'https://www.zhihu.com/zvideo/333',
      'https://www.zhihu.com/question/444?utm_psn=1',
    ]);
    expect(seenUrls.has('https://zhuanlan.zhihu.com/p/222')).toBe(true);
    expect(seenUrls.has('https://www.zhihu.com/zvideo/333')).toBe(true);
    expect(seenUrls.has('https://www.zhihu.com/question/444?utm_psn=1')).toBe(true);
  });

  test('ignores non seed bindings and non list pages', () => {
    const seenUrls = new Set<string>();

    expect(collectDeepSearchFollowUpUrls({
      siteKey: 'zhihu',
      bindingRole: 'detail',
      extraction: {
        url: 'https://www.zhihu.com/question/123',
        title: '问题',
        lines: [],
        contentText: '正文',
        contentState: 'full',
        snippet: '正文',
        evidenceCount: 1,
        structuredData: {
          pageType: 'question_detail',
          results: [{ url: 'https://www.zhihu.com/question/456' }],
        },
      },
      seenUrls,
    })).toEqual([]);

    expect(collectDeepSearchFollowUpUrls({
      siteKey: 'zhihu',
      bindingRole: 'seed',
      extraction: {
        url: 'https://www.zhihu.com/question/123',
        title: '问题',
        lines: [],
        contentText: '正文',
        contentState: 'full',
        snippet: '正文',
        evidenceCount: 1,
        structuredData: {
          pageType: 'question_detail',
        },
      },
      seenUrls,
    })).toEqual([]);
  });
});
