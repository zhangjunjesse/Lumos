const mockFetchSearchSamples = jest.fn();
const mockBuildPlatformSearchUrl = jest.fn();
const mockGetEcommerceStore = jest.fn(() => ({ id: 'mock-store' }));
const mockListDeepSearchSitesView = jest.fn();
const mockListDeepSearchRunsView = jest.fn(async () => []);
const mockDouyinStoreQuery = jest.fn(() => []);

jest.mock('../web-research', () => ({
  fetchSearchSamples: (...args: unknown[]) => mockFetchSearchSamples(...args),
  buildPlatformSearchUrl: (...args: unknown[]) => mockBuildPlatformSearchUrl(...args),
}));
jest.mock('../storage', () => ({
  getEcommerceStore: () => mockGetEcommerceStore(),
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
  resetRegisteredSourcesForTesting,
  type ResearchSourceContext,
} from '../research-sources';

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

describe('web research adapter', () => {
  it('maps fetchSearchSamples output into ResearchSourceItem shape with facts snippet', async () => {
    mockBuildPlatformSearchUrl.mockReturnValueOnce({
      source: 'etsy',
      url: 'https://etsy.com/search?q=…',
      acceptLanguage: 'en-US,en;q=0.9',
    });
    mockFetchSearchSamples.mockResolvedValueOnce({
      source: 'etsy',
      url: 'https://etsy.com/search?q=…',
      samples: [
        {
          title: 'Handmade Mug A',
          url: 'https://etsy.com/listing/1',
          price: '$32',
          rating: '4.8',
          reviews: '120',
          sales: '500+',
          brand: 'Brand X',
          heatLevel: 'hot',
          heatScore: 0.91,
        },
      ],
      details: [],
      fetchedAt: '2026-05-13T00:00:00.000Z',
    });

    const result = await getRegisteredSource('web')!(ctx());

    expect(mockBuildPlatformSearchUrl).toHaveBeenCalledWith('etsy', '手作陶瓷杯');
    expect(mockFetchSearchSamples).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'etsy', maxSamples: 12, store: { id: 'mock-store' } }),
    );
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Handmade Mug A');
    expect(result.items[0].snippet).toContain('价格 $32');
    expect(result.items[0].snippet).toContain('评分 4.8');
    expect(result.items[0].snippet).toContain('销量 500+');
    expect(result.items[0].score).toBe(0.91);
  });

  it('returns ok=false with explanation when the platform has no search URL mapping', async () => {
    mockBuildPlatformSearchUrl.mockReturnValueOnce(null);

    const result = await getRegisteredSource('web')!(ctx({ platform: 'unknown' }));

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/不支持平台/);
    expect(mockFetchSearchSamples).not.toHaveBeenCalled();
  });

  it('passes through fetchSearchSamples warning', async () => {
    mockBuildPlatformSearchUrl.mockReturnValueOnce({
      source: 'etsy',
      url: 'u',
      acceptLanguage: 'en',
    });
    mockFetchSearchSamples.mockResolvedValueOnce({
      source: 'etsy',
      url: 'u',
      samples: [],
      details: [],
      fetchedAt: 't',
      warning: 'captcha 命中',
    });

    const result = await getRegisteredSource('web')!(ctx());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('captcha 命中');
  });
});

describe('deepsearch adapter', () => {
  it('returns matching sites by siteKey contains-match (case-insensitive)', async () => {
    mockListDeepSearchSitesView.mockResolvedValueOnce([
      { siteKey: 'etsy', displayName: 'Etsy', cookieStatus: 'valid', hasCookie: true, baseUrl: 'https://etsy.com', lastValidatedAt: '2026-05-12' },
      { siteKey: 'xhs', displayName: '小红书', cookieStatus: 'missing', hasCookie: false, baseUrl: 'https://www.xiaohongshu.com', lastValidatedAt: null },
    ]);

    const result = await getRegisteredSource('deepsearch')!(ctx({ platform: 'ETSY' }));

    expect(result.ok).toBe(true);
    const titles = result.items.map((i) => i.title);
    expect(titles).toContain('Etsy');
    // Always appends a "继续深挖建议" hint card at the end.
    expect(titles[titles.length - 1]).toContain('继续深挖');
  });

  it('returns informational item when no site matches the platform', async () => {
    mockListDeepSearchSitesView.mockResolvedValueOnce([
      { siteKey: 'xhs', displayName: '小红书', cookieStatus: 'valid', hasCookie: true, baseUrl: 'x', lastValidatedAt: null },
    ]);

    const result = await getRegisteredSource('deepsearch')!(ctx({ platform: 'amazon' }));

    expect(result.ok).toBe(true);
    expect(result.items[0].title).toMatch(/没有匹配/);
    expect(result.items[0].snippet).toMatch(/xhs/);
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

  it('appends recent completed runs whose siteKeys overlap with matched sites', async () => {
    mockListDeepSearchRunsView.mockResolvedValueOnce([
      {
        id: 'run-1',
        queryText: 'handmade mug',
        siteKeys: ['etsy'],
        status: 'completed',
        resultSummary: '10 items 抓到，3 个高评分',
        completedAt: '2026-05-12T12:00:00Z',
        records: [{ id: 'r1' }],
        artifacts: [],
      },
      {
        id: 'run-2',
        queryText: 'unrelated',
        siteKeys: ['xhs'],
        status: 'completed',
        resultSummary: 'noise',
        records: [],
        artifacts: [],
      },
    ]);

    const result = await getRegisteredSource('deepsearch')!(ctx({ platform: 'etsy' }));

    const runTitles = result.items.filter((i) => i.title.startsWith('DeepSearch run')).map((i) => i.title);
    expect(runTitles).toHaveLength(1);
    expect(runTitles[0]).toContain('handmade mug');
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
