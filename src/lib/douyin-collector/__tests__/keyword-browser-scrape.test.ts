import vm from 'node:vm';

import type { BrowserBridgeRuntimeConfig } from '@/lib/browser-runtime/bridge-client';
import {
  CREATOR_SCRAPE_SCRIPT,
  buildCreatorScrapeExpression,
  closeDouyinScrapePage,
  describeDouyinChallengePage,
  focusDouyinScrapePage,
} from '../creator-browser-scrape';
import { buildKeywordSearchUrl, KEYWORD_SCRAPE_SCRIPT } from '../keyword-browser-scrape';

interface FakeNode {
  attributes: Array<{ name: string; value: string }>;
  getAttribute: (name: string) => string | null;
  [key: string]: unknown;
}

function makeNode(attrs: Record<string, string>, reactValue?: unknown): FakeNode {
  const node: FakeNode = {
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    getAttribute: (name: string) => attrs[name] ?? null,
  };
  if (reactValue) node.__reactProps$test = reactValue;
  return node;
}

async function runKeywordScript(input: {
  html?: string;
  anchors?: FakeNode[];
  nodes?: FakeNode[];
  windowState?: Record<string, unknown>;
}) {
  const anchors = input.anchors ?? [];
  const nodes = input.nodes ?? [];
  const context = {
    document: {
      title: '发现更多精彩视频 - 抖音搜索',
      documentElement: { outerHTML: input.html ?? '' },
      body: { innerText: '搜索结果' },
      querySelectorAll: (selector: string) => {
        if (selector === 'a[href]') return anchors;
        return nodes;
      },
    },
    location: { href: 'https://www.douyin.com/search/AI?type=general' },
    window: {
      scrollTo: jest.fn(),
      ...(input.windowState ?? {}),
    },
    Set,
    Promise,
    setTimeout,
    decodeURIComponent,
    String,
    JSON,
    Object,
    RegExp,
  };
  return vm.runInNewContext(KEYWORD_SCRAPE_SCRIPT, context) as Promise<{
    ok: boolean;
    items: Array<{ awemeId: string; source: string; href: string | null }>;
  }>;
}

async function runCreatorScript(input: {
  html?: string;
  anchors?: FakeNode[];
  anchorsByCall?: FakeNode[][];
}) {
  let callCount = 0;
  const context = {
    document: {
      title: 'AIGC云造物的抖音 - 抖音',
      documentElement: { outerHTML: input.html ?? '' },
      body: { innerText: '作品列表', scrollHeight: 3600 },
      querySelectorAll: (selector: string) => {
        if (selector !== 'a[href]') return [];
        if (input.anchorsByCall) {
          const value = input.anchorsByCall[Math.min(callCount, input.anchorsByCall.length - 1)] ?? [];
          callCount += 1;
          return value;
        }
        return input.anchors ?? [];
      },
    },
    location: { href: 'https://www.douyin.com/user/sec-test' },
    window: { scrollTo: jest.fn() },
    Set,
    Promise,
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
    decodeURIComponent,
    String,
    JSON,
    Object,
    RegExp,
  };
  return vm.runInNewContext(CREATOR_SCRAPE_SCRIPT, context) as Promise<{
    ok: boolean;
    items: Array<{ awemeId: string; source: string; href: string | null }>;
    hrefCount: number;
    htmlLength: number;
  }>;
}

describe('CREATOR_SCRAPE_SCRIPT', () => {
  it('wraps foreground evaluate script without returning undefined after ASI', async () => {
    const expression = buildCreatorScrapeExpression({ mode: 'full', maxVideos: 300 });
    const result = await vm.runInNewContext(expression, {
      document: {
        title: 'AIGC云造物的抖音 - 抖音',
        documentElement: { outerHTML: '' },
        body: { innerText: '作品列表', scrollHeight: 3600 },
        querySelectorAll: () => [makeNode({ href: '/video/7629572668472737514' })],
        scrollingElement: { scrollHeight: 3600, scrollTop: 0 },
      },
      location: { href: 'https://www.douyin.com/user/sec-test' },
      window: { scrollTo: jest.fn(), dispatchEvent: jest.fn() },
      WheelEvent: function WheelEvent() {},
      Set,
      Promise,
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
      decodeURIComponent,
      Math,
      String,
      JSON,
      Object,
      RegExp,
    }) as { ok?: boolean; items?: Array<{ awemeId?: string }> };

    expect(result).toBeTruthy();
    expect(result.ok).toBe(true);
    expect(result.items?.map((item) => item.awemeId)).toEqual(['7629572668472737514']);
  });

  it('does not treat hydration-only aweme ids as a successful creator feed', async () => {
    const result = await runCreatorScript({
      html: '<script>{"awemeId":"7022771022038388255"}</script>',
      anchors: [],
    });

    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
  });

  it('collects real creator video anchors and skips Baiduspider recommendations', async () => {
    const result = await runCreatorScript({
      anchors: [
        makeNode({ href: '/video/7631811186518569542?source=Baiduspider' }),
        makeNode({ href: '/video/7629572668472737514' }),
        makeNode({ href: 'https%3A%2F%2Fwww.douyin.com%2Fvideo%2F7628119222573629395' }),
      ],
    });

    expect(result.items.map((item) => item.awemeId)).toEqual([
      '7629572668472737514',
      '7628119222573629395',
    ]);
  });

  it('waits for lazy-rendered anchors before returning', async () => {
    const result = await runCreatorScript({
      anchorsByCall: [
        [],
        [],
        [makeNode({ href: '/video/7629572668472737514' })],
      ],
    });

    expect(result.items.map((item) => item.awemeId)).toEqual(['7629572668472737514']);
  });

  it('accumulates IDs across virtualized scroll batches', async () => {
    const result = await runCreatorScript({
      anchorsByCall: [
        [makeNode({ href: '/video/7629572668472737514' })],
        [makeNode({ href: '/video/7628119222573629395' })],
        [makeNode({ href: '/video/7627427491653244294' })],
      ],
    });

    expect(result.items.map((item) => item.awemeId)).toEqual([
      '7629572668472737514',
      '7628119222573629395',
      '7627427491653244294',
    ]);
  });
});

describe('buildKeywordSearchUrl', () => {
  it('matches douyin current desktop search route', () => {
    expect(buildKeywordSearchUrl('AI', '7d7c467a-f443-4e21-b94e-c404d95fcd31')).toBe(
      'https://www.douyin.com/search/AI?aid=7d7c467a-f443-4e21-b94e-c404d95fcd31&type=general',
    );
  });

  it('uses search for multi-word keywords instead of hashtag/type=video', () => {
    const url = buildKeywordSearchUrl('DeepSeek v4 最大的挑战', 'aid-test');

    expect(url).toContain('/search/DeepSeek%20v4%20');
    expect(url).toContain('aid=aid-test');
    expect(url).toContain('type=general');
    expect(url).not.toContain('/hashtag/');
    expect(url).not.toContain('type=video');
  });

  it('extracts IDs from escaped hydration JSON in rendered search html', async () => {
    const result = await runKeywordScript({
      html: '<script>{\\"awemeId\\":\\"7321234567890123456\\"}</script>',
    });

    expect(result.ok).toBe(true);
    expect(result.items.map((item) => item.awemeId)).toContain('7321234567890123456');
  });

  it('extracts IDs from encoded douyin video hrefs', async () => {
    const result = await runKeywordScript({
      anchors: [
        makeNode({
          href: 'https%3A%2F%2Fwww.douyin.com%2Fvideo%2F7321234567890123457',
        }),
      ],
    });

    expect(result.items.map((item) => item.awemeId)).toContain('7321234567890123457');
  });

  it('extracts IDs from React props when cards are not plain links', async () => {
    const result = await runKeywordScript({
      nodes: [
        makeNode(
          { role: 'link' },
          { item: { awemeId: '7321234567890123458', desc: '电商竞品分析' } },
        ),
      ],
    });

    expect(result.items.map((item) => item.awemeId)).toContain('7321234567890123458');
  });

  it('ignores date-like long numbers that are not aweme IDs', async () => {
    const result = await runKeywordScript({
      html: [
        '<script>{\\"awemeId\\":\\"2026051117544938858\\"}</script>',
        '<script>{\\"awemeId\\":\\"7321234567890123459\\"}</script>',
      ].join(''),
    });

    const ids = result.items.map((item) => item.awemeId);
    expect(ids).not.toContain('2026051117544938858');
    expect(ids).toContain('7321234567890123459');
  });
});

describe('closeDouyinScrapePage', () => {
  const originalFetch = global.fetch;
  const config: BrowserBridgeRuntimeConfig = {
    baseUrl: 'http://bridge.test',
    token: 'bridge-token',
    source: 'env',
    browserContextId: 'adspower:k1',
    lockOwnerId: 'douyin-collector',
  };

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('closes the bridge page id and keeps the browser context intact', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ ok: true, closed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await closeDouyinScrapePage(config, ' page-1 ');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://bridge.test/v1/pages/close?browserContextId=adspower%3Ak1');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ pageId: 'page-1' });
  });

  it('skips missing page ids', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await closeDouyinScrapePage(config, '   ');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fail the scrape when close fails', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('close failed');
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(closeDouyinScrapePage(config, 'page-1')).resolves.toBeUndefined();
  });
});

describe('focusDouyinScrapePage', () => {
  const originalFetch = global.fetch;
  const config: BrowserBridgeRuntimeConfig = {
    baseUrl: 'http://bridge.test',
    token: 'bridge-token',
    source: 'env',
    browserContextId: 'adspower:k1',
    lockOwnerId: 'douyin-collector',
  };

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('selects the bridge page so the user can pass manual verification', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ ok: true, pageId: 'page-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(focusDouyinScrapePage(config, ' page-1 ')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://bridge.test/v1/pages/select?browserContextId=adspower%3Ak1');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      pageId: 'page-1',
      background: false,
    });
  });

  it('returns false instead of throwing when selecting fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('select failed');
    }) as unknown as typeof fetch;

    await expect(focusDouyinScrapePage(config, 'page-1')).resolves.toBe(false);
  });
});

describe('describeDouyinChallengePage', () => {
  it('tells the user to pass verification and retry when the page was focused', () => {
    expect(describeDouyinChallengePage('验证码中间页', true)).toContain('已保留并切到这个采集页');
    expect(describeDouyinChallengePage('验证码中间页', true)).toContain('点击「立即采集」');
  });
});
