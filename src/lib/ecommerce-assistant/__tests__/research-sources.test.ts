const mockFetchTopicKnowledge = jest.fn();
const mockListDeepSearchSitesView = jest.fn();
const mockListDeepSearchRunsView = jest.fn(async () => []);
const mockDouyinStoreQuery = jest.fn(() => []);

jest.mock('../research-web-knowledge', () => ({
  fetchTopicKnowledge: (...args: unknown[]) => mockFetchTopicKnowledge(...args),
}));
jest.mock('@/lib/deepsearch/service', () => ({
  listDeepSearchSitesView: (...args: unknown[]) => mockListDeepSearchSitesView(...args),
  listDeepSearchRunsView: (...args: unknown[]) => mockListDeepSearchRunsView(...args),
}));
jest.mock('@/lib/douyin-collector/storage', () => ({
  getDouyinCollectorStore: () => ({
    query: (...args: unknown[]) => mockDouyinStoreQuery(...args),
  }),
}));
jest.mock('@/lib/douyin-collector/constants', () => ({
  COLLECTION_VIDEOS: 'videos',
  DOUYIN_COLLECTOR_APP_ID: 'douyin-collector',
}));

import {
  getRegisteredSource,
  type ResearchSourceContext,
} from '../research-sources';
import { resetRegisteredSourcesForTesting } from '../research-source-adapters';

function ctx(overrides: Partial<ResearchSourceContext> = {}): ResearchSourceContext {
  return {
    platform: 'etsy',
    query: '手作陶瓷杯',
    instruction: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListDeepSearchRunsView.mockResolvedValue([]);
  mockDouyinStoreQuery.mockReturnValue([]);
  resetRegisteredSourcesForTesting();
});

describe('web research adapter (B: 选题/知识检索，不抓 marketplace、不开浏览器)', () => {
  it('maps topic-knowledge results into ResearchSourceItem data; platform is only context', async () => {
    mockFetchTopicKnowledge.mockResolvedValueOnce({
      searchQuery: '如何选品 etsy',
      items: [
        { title: 'Etsy 选品方法论', url: 'https://example.com/a', snippet: '从需求与竞争出发' },
        { title: '选品避坑', url: 'https://example.com/b' },
      ],
    });

    const result = await getRegisteredSource('web')!(ctx({ query: '如何选品' }));

    // query 当主题，platform 仅作上下文传入；绝不调用 marketplace URL 构造。
    expect(mockFetchTopicKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ query: '如何选品', platform: 'etsy', maxResults: 12 }),
    );
    expect(result.ok).toBe(true);
    const data = result.items.filter((i) => i.kind !== 'notice');
    expect(data).toHaveLength(2);
    expect(data[0].title).toBe('Etsy 选品方法论');
    expect(data[0].url).toBe('https://example.com/a');
    expect(data[0].snippet).toContain('从需求与竞争出发');
  });

  it('zero results → honest notice (no real data), never fabricates', async () => {
    mockFetchTopicKnowledge.mockResolvedValueOnce({
      searchQuery: '如何选品',
      items: [],
      warning: '主题检索 HTTP 429（被限流）。',
    });

    const result = await getRegisteredSource('web')!(ctx({ query: '如何选品', platform: 'general' }));

    expect(result.ok).toBe(true);
    expect(result.items.every((i) => i.kind === 'notice')).toBe(true);
    expect(result.items.filter((i) => i.kind !== 'notice')).toHaveLength(0);
    expect(result.items[0].snippet).toContain('被限流');
    expect(result.items[0].snippet).toContain('如何选品');
  });
});

describe('deepsearch adapter', () => {
  it('B: lists ALL configured sites regardless of platform (no platform-name gate)', async () => {
    mockListDeepSearchSitesView.mockResolvedValueOnce([
      { siteKey: 'etsy', displayName: 'Etsy', cookieStatus: 'valid', hasCookie: true, baseUrl: 'https://etsy.com', lastValidatedAt: '2026-05-12' },
      { siteKey: 'xhs', displayName: '小红书', cookieStatus: 'missing', hasCookie: false, baseUrl: 'https://www.xiaohongshu.com', lastValidatedAt: null },
    ]);

    // platform 与任何站点 key/name 都不沾边，旧逻辑会整体挡掉；B 下不再过滤。
    const result = await getRegisteredSource('deepsearch')!(ctx({ platform: 'etsy' }));

    expect(result.ok).toBe(true);
    const titles = result.items.map((i) => i.title);
    expect(titles).toContain('Etsy');
    expect(titles).toContain('小红书'); // 不含 platform 名的站点也要出现
    expect(titles[titles.length - 1]).toContain('继续深挖');
  });

  it('matched site list is notice, not data (no prior runs → zero real data)', async () => {
    mockListDeepSearchSitesView.mockResolvedValueOnce([
      { siteKey: 'zhihu', displayName: '知乎', cookieStatus: 'valid', hasCookie: true, baseUrl: 'https://zhihu.com', lastValidatedAt: '2026-05-12' },
    ]);
    mockListDeepSearchRunsView.mockResolvedValueOnce([]); // 无历史 run

    const result = await getRegisteredSource('deepsearch')!(ctx({ platform: 'zhihu' }));

    // 站点配置/登录态是能力清单，不是调研数据：全部 notice，真实数据 0。
    expect(result.items.every((i) => i.kind === 'notice')).toBe(true);
    expect(result.items.filter((i) => i.kind !== 'notice')).toHaveLength(0);
    const site = result.items.find((i) => i.title === '知乎')!;
    expect(site.kind).toBe('notice');
    expect(site.snippet).toMatch(/siteKey=zhihu/);
  });

  it('a related DeepSearch run IS real data (counts), site stays notice', async () => {
    mockListDeepSearchSitesView.mockResolvedValueOnce([
      { siteKey: 'zhihu', displayName: '知乎', cookieStatus: 'valid', hasCookie: true, baseUrl: 'z', lastValidatedAt: null },
    ]);
    mockListDeepSearchRunsView.mockResolvedValueOnce([
      { id: 'run-9', queryText: '手作陶瓷杯', siteKeys: ['zhihu'], status: 'completed', resultSummary: '12 条', records: [{ id: 'a' }], artifacts: [] },
    ]);

    const result = await getRegisteredSource('deepsearch')!(ctx({ platform: 'zhihu', query: '手作陶瓷杯' }));

    const data = result.items.filter((i) => i.kind !== 'notice');
    expect(data).toHaveLength(1);
    expect(data[0].title).toContain('DeepSearch run');
    expect(result.items.find((i) => i.title === '知乎')!.kind).toBe('notice');
  });

  it('B: platform unrelated to any site no longer blocks — sites still surfaced', async () => {
    mockListDeepSearchSitesView.mockResolvedValueOnce([
      { siteKey: 'xhs', displayName: '小红书', cookieStatus: 'valid', hasCookie: true, baseUrl: 'x', lastValidatedAt: null },
    ]);

    const result = await getRegisteredSource('deepsearch')!(ctx({ platform: 'amazon' }));

    expect(result.ok).toBe(true);
    // 旧逻辑此处返回「没有匹配」整体挡掉；B 下站点正常作为能力 notice 出现。
    expect(result.items.some((i) => i.title === '小红书')).toBe(true);
    expect(result.items.find((i) => i.title === '小红书')!.snippet).toMatch(/siteKey=xhs/);
  });

  it('B: only-empty-when-no-sites-configured notice', async () => {
    mockListDeepSearchSitesView.mockResolvedValueOnce([]);

    const result = await getRegisteredSource('deepsearch')!(ctx({ platform: 'etsy' }));

    expect(result.ok).toBe(true);
    expect(result.items[0].title).toMatch(/还没有配置 DeepSearch 站点/);
  });

  it('returns ok=false with error when listDeepSearchSitesView throws', async () => {
    mockListDeepSearchSitesView.mockRejectedValueOnce(new Error('db down'));

    const result = await getRegisteredSource('deepsearch')!(ctx());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('db down');
  });
});

describe('deepsearch adapter — recent runs', () => {
  beforeEach(() => {
    mockListDeepSearchSitesView.mockResolvedValue([
      { siteKey: 'etsy', displayName: 'Etsy', cookieStatus: 'valid', hasCookie: true, baseUrl: 'https://etsy.com', lastValidatedAt: '2026-05-12' },
    ]);
  });

  it('B: appends runs by queryText overlap with the topic — NOT by site overlap', async () => {
    mockListDeepSearchRunsView.mockResolvedValueOnce([
      {
        id: 'run-1',
        queryText: '手作陶瓷杯选品调研',
        siteKeys: ['zhihu'], // 站点不沾 platform，旧 siteOverlap 不会命中
        status: 'completed',
        resultSummary: '10 条要点',
        completedAt: '2026-05-12T12:00:00Z',
        records: [{ id: 'r1' }],
        artifacts: [],
      },
      {
        id: 'run-2',
        queryText: 'unrelated topic',
        siteKeys: ['etsy'], // 站点命中 platform，但 query 无关 → B 下必须排除
        status: 'completed',
        resultSummary: 'noise',
        records: [],
        artifacts: [],
      },
    ]);

    const result = await getRegisteredSource('deepsearch')!(ctx({ platform: 'etsy', query: '手作陶瓷杯' }));

    const runTitles = result.items.filter((i) => i.title.startsWith('DeepSearch run')).map((i) => i.title);
    expect(runTitles).toHaveLength(1);
    expect(runTitles[0]).toContain('手作陶瓷杯选品调研');
    expect(result.items.find((i) => i.title.startsWith('DeepSearch run'))?.meta?.run_id).toBe('run-1');
  });

  it('also matches runs by queryText overlap with current query', async () => {
    mockListDeepSearchRunsView.mockResolvedValueOnce([
      {
        id: 'run-3',
        queryText: '手作陶瓷杯热销趋势',
        siteKeys: [],
        status: 'completed',
        resultSummary: 'ok',
        records: [],
        artifacts: [],
      },
    ]);

    const result = await getRegisteredSource('deepsearch')!(ctx({ query: '手作陶瓷杯' }));

    expect(result.items.some((i) => i.title.includes('手作陶瓷杯热销趋势'))).toBe(true);
  });

  it('filters out failed and cancelled runs', async () => {
    mockListDeepSearchRunsView.mockResolvedValueOnce([
      { id: 'r1', queryText: '手作陶瓷杯', siteKeys: ['etsy'], status: 'failed', records: [], artifacts: [] },
      { id: 'r2', queryText: '手作陶瓷杯', siteKeys: ['etsy'], status: 'cancelled', records: [], artifacts: [] },
    ]);

    const result = await getRegisteredSource('deepsearch')!(ctx());
    expect(result.items.filter((i) => i.title.startsWith('DeepSearch run'))).toHaveLength(0);
  });

  it('records a warning item when listDeepSearchRunsView itself throws', async () => {
    mockListDeepSearchRunsView.mockRejectedValueOnce(new Error('runs db corrupt'));

    const result = await getRegisteredSource('deepsearch')!(ctx());
    expect(result.ok).toBe(true);
    expect(result.items.some((i) => i.title.startsWith('⚠️ 无法读取最近 DeepSearch run'))).toBe(true);
  });
});

describe('douyin adapter', () => {
  it('skips when platform != douyin and query has no 抖音 keyword', async () => {
    const result = await getRegisteredSource('douyin')!(ctx({ platform: 'etsy', query: '手作陶瓷杯' }));
    expect(result.ok).toBe(true);
    expect(result.items[0].title).toMatch(/未指向抖音/);
  });

  it('returns matched videos from the douyin-collector store, with creator and transcript meta', async () => {
    mockDouyinStoreQuery.mockReturnValue([
      {
        id: 'v1',
        aweme_id: '7000000001',
        title: '保温杯礼盒拆箱',
        creator_nickname: 'creator-a',
        creator_ref: 'sec_uid_a',
        duration_seconds: 87,
        transcript_status: 'completed',
        library_status: 'published',
        summary: '展示保温杯包装设计与送礼场景',
        cover: 'https://x.com/cover.jpg',
        tags: JSON.stringify(['保温杯', '送礼']),
        updated_at: '2026-05-12T10:00:00Z',
      },
      {
        id: 'v2',
        title: '不相关视频',
        creator_nickname: 'noise',
        tags: JSON.stringify(['美食']),
        updated_at: '2026-05-12T09:00:00Z',
      },
    ]);

    const result = await getRegisteredSource('douyin')!(ctx({ platform: 'douyin', query: '保温杯' }));

    expect(result.ok).toBe(true);
    const titles = result.items.map((i) => i.title);
    expect(titles).toContain('保温杯礼盒拆箱');
    expect(titles).not.toContain('不相关视频');
    const matched = result.items.find((i) => i.title === '保温杯礼盒拆箱')!;
    expect(matched.url).toBe('https://www.douyin.com/video/7000000001');
    expect(matched.snippet).toContain('作者 creator-a');
    expect(matched.snippet).toContain('转写 completed');
    expect(matched.meta?.aweme_id).toBe('7000000001');
  });

  it('strips "抖音"/"douyin" tokens from the query so combined queries still match', async () => {
    mockDouyinStoreQuery.mockReturnValue([
      {
        id: 'v3',
        title: '礼物挂坠测评',
        tags: JSON.stringify(['挂坠']),
        updated_at: '2026-05-12T08:00:00Z',
      },
    ]);

    const result = await getRegisteredSource('douyin')!(
      ctx({ platform: 'douyin', query: '抖音 礼物挂坠' }),
    );

    expect(result.items.some((i) => i.title === '礼物挂坠测评')).toBe(true);
  });

  it('emits onboarding guidance when store is empty', async () => {
    mockDouyinStoreQuery.mockReturnValue([]);
    const result = await getRegisteredSource('douyin')!(ctx({ platform: 'douyin', query: '保温杯' }));
    expect(result.items[0].title).toMatch(/还没有任何视频/);
  });

  it('emits an explanatory item when store has data but no matches', async () => {
    mockDouyinStoreQuery.mockReturnValue([
      { id: 'v', title: '美食测评', tags: JSON.stringify(['美食']), updated_at: '2026-05-12' },
    ]);
    const result = await getRegisteredSource('douyin')!(ctx({ platform: 'douyin', query: '保温杯' }));
    expect(result.items[0].title).toMatch(/无 "保温杯" 命中/);
  });

  it('surfaces a clear error when the douyin store import/query throws', async () => {
    mockDouyinStoreQuery.mockImplementationOnce(() => {
      throw new Error('douyin db locked');
    });
    const result = await getRegisteredSource('douyin')!(ctx({ platform: 'douyin', query: '保温杯' }));
    expect(result.items[0].title).toMatch(/采集器数据库不可用/);
    expect(result.items[0].snippet).toMatch(/douyin db locked/);
  });
});
