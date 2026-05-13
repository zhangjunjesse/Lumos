/**
 * Pluggable data-source adapters for research reports.
 *
 * Each source produces a uniform `ResearchSourceResult`. Real adapters
 * (deepsearch, douyin, web-research) plug in here in the same shape; the
 * runner orchestrates them in parallel with timeouts and source failures
 * are recorded — never abort the whole report.
 */

export interface ResearchSourceContext {
  platform: string;
  query: string;
  instruction: string | null;
  signal: AbortSignal;
}

export interface ResearchSourceItem {
  title: string;
  url?: string;
  snippet?: string;
  score?: number;
  meta?: Record<string, unknown>;
}

export interface ResearchSourceResult {
  source: string;
  ok: boolean;
  items: ResearchSourceItem[];
  error?: string;
  latency_ms?: number;
}

export type ResearchSource = (ctx: ResearchSourceContext) => Promise<ResearchSourceResult>;

const REGISTRY = new Map<string, ResearchSource>();

export function registerResearchSource(name: string, source: ResearchSource): void {
  REGISTRY.set(name, source);
}

export function getRegisteredSourceNames(): string[] {
  return Array.from(REGISTRY.keys()).sort();
}

export function getRegisteredSource(name: string): ResearchSource | undefined {
  return REGISTRY.get(name);
}

export function resetRegisteredSourcesForTesting(): void {
  REGISTRY.clear();
  registerDefaultSources();
}

// --- default built-in sources ---

function registerDefaultSources(): void {
  registerResearchSource('web', webAdapter);
  registerResearchSource('deepsearch', deepsearchAdapter);
  registerResearchSource('douyin', douyinAdapter);
}

const WEB_MAX_SAMPLES = 12;

async function webAdapter(ctx: ResearchSourceContext): Promise<ResearchSourceResult> {
  // Dynamic import keeps the registry module side-effect-free at load time.
  const { fetchSearchSamples, buildPlatformSearchUrl } = await import('./web-research');
  const { getEcommerceStore } = await import('./storage');

  const url = buildPlatformSearchUrl(ctx.platform, ctx.query);
  if (!url) {
    return {
      source: 'web',
      ok: false,
      items: [],
      error: `web 适配器暂不支持平台 "${ctx.platform}"（受支持：amazon-us/amazon-uk/amazon-jp/amazon-de/etsy/walmart/tiktok-shop-us）`,
    };
  }

  const result = await fetchSearchSamples({
    source: url.source,
    url: url.url,
    acceptLanguage: url.acceptLanguage,
    abortSignal: ctx.signal,
    maxSamples: WEB_MAX_SAMPLES,
    store: getEcommerceStore(),
  });

  const items: ResearchSourceItem[] = (result.samples ?? []).map((sample) => {
    const facts: string[] = [];
    if (sample.price) facts.push(`价格 ${sample.price}`);
    if (sample.rating) facts.push(`评分 ${sample.rating}`);
    if (sample.reviews) facts.push(`评论 ${sample.reviews}`);
    if (sample.sales) facts.push(`销量 ${sample.sales}`);
    if (sample.brand) facts.push(`品牌 ${sample.brand}`);
    if (sample.heatLevel) facts.push(`热度 ${sample.heatLevel}`);
    return {
      title: sample.title,
      url: sample.url,
      snippet: facts.join(' · ') || undefined,
      score: typeof sample.heatScore === 'number' ? sample.heatScore : undefined,
      meta: {
        price: sample.price,
        rating: sample.rating,
        reviews: sample.reviews,
        sales: sample.sales,
        brand: sample.brand,
        category: sample.category,
        image_url: sample.imageUrl,
        badges: sample.badges,
        heat_level: sample.heatLevel,
        heat_score: sample.heatScore,
      },
    };
  });

  const ok = items.length > 0 || !result.warning;
  return {
    source: 'web',
    ok,
    items,
    error: result.warning,
  };
}

async function deepsearchAdapter(ctx: ResearchSourceContext): Promise<ResearchSourceResult> {
  const { listDeepSearchSitesView } = await import('@/lib/deepsearch/service');
  let sites: Awaited<ReturnType<typeof listDeepSearchSitesView>> = [];
  try {
    sites = await listDeepSearchSitesView();
  } catch (err) {
    return {
      source: 'deepsearch',
      ok: false,
      items: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const platform = ctx.platform.toLowerCase();
  const matched = sites.filter((s) => {
    const key = String(s.siteKey ?? '').toLowerCase();
    const name = String(s.displayName ?? '').toLowerCase();
    return key.includes(platform) || name.includes(platform);
  });

  if (matched.length === 0) {
    return {
      source: 'deepsearch',
      ok: true,
      items: [
        {
          title: '没有匹配 DeepSearch 站点',
          snippet:
            sites.length === 0
              ? '当前还没有配置任何 DeepSearch 站点。请到「设置 → DeepSearch」添加站点并完成登录验证后，再回到此处重新跑调研。'
              : `当前 ${sites.length} 个站点中没有 key/name 包含 "${ctx.platform}" 的。可用 keys：${sites.map((s) => s.siteKey).join(', ')}`,
        },
      ],
    };
  }

  const items: ResearchSourceItem[] = matched.map((site) => ({
    title: site.displayName || site.siteKey,
    snippet: [
      `siteKey=${site.siteKey}`,
      `cookieStatus=${site.cookieStatus}`,
      site.hasCookie ? 'cookie 已配置' : 'cookie 未配置',
      site.lastValidatedAt ? `最近校验 ${site.lastValidatedAt}` : '未校验',
    ].join(' · '),
    meta: {
      site_key: site.siteKey,
      cookie_status: site.cookieStatus,
      has_cookie: site.hasCookie,
      base_url: site.baseUrl,
    },
  }));

  // Pull recent completed runs that touched any matched site or whose
  // queryText already overlaps with the current query — these are real
  // researched artifacts we can reference instead of just listing sites.
  try {
    const { listDeepSearchRunsView } = await import('@/lib/deepsearch/service');
    const runs = await listDeepSearchRunsView(50);
    const matchedKeys = new Set(matched.map((s) => s.siteKey));
    const needle = ctx.query.trim().toLowerCase();
    const relatedRuns = runs.filter((run) => {
      const status = String(run.status ?? '').toLowerCase();
      if (status === 'failed' || status === 'cancelled') return false;
      const siteOverlap = (run.siteKeys ?? []).some((k) => matchedKeys.has(k));
      const queryOverlap =
        needle.length > 0 && String(run.queryText ?? '').toLowerCase().includes(needle);
      return siteOverlap || queryOverlap;
    });
    if (relatedRuns.length > 0) {
      relatedRuns.slice(0, 5).forEach((run) => {
        items.push({
          title: `DeepSearch run · ${run.queryText || '(无 query)'}`,
          snippet: [
            `status=${run.status}`,
            run.siteKeys?.length ? `sites=${run.siteKeys.join(',')}` : null,
            run.resultSummary ? trimSnippet(run.resultSummary, 160) : null,
            run.completedAt ? `完成于 ${run.completedAt}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          meta: {
            run_id: run.id,
            status: run.status,
            site_keys: run.siteKeys,
            record_count: run.records?.length ?? 0,
            artifact_count: run.artifacts?.length ?? 0,
            completed_at: run.completedAt,
          },
        });
      });
    }
  } catch (err) {
    // Run-listing failure is non-fatal; the site list above is still useful.
    items.push({
      title: '⚠️ 无法读取最近 DeepSearch run',
      snippet: err instanceof Error ? err.message : String(err),
    });
  }

  // We intentionally don't kick off a deepsearch run here — those are
  // multi-minute jobs the user reviews in the dedicated DeepSearch tab.
  items.push({
    title: '继续深挖建议',
    snippet:
      '到「设置 → DeepSearch」选中以上 siteKey 启动一次正式 deepsearch run（多分钟级），run 完成后下次本任务能在「DeepSearch run」段引用结果。',
  });

  return { source: 'deepsearch', ok: true, items };
}

async function douyinAdapter(ctx: ResearchSourceContext): Promise<ResearchSourceResult> {
  const wantsDouyin =
    ctx.platform.toLowerCase() === 'douyin' || /抖音|douyin/i.test(ctx.query);
  if (!wantsDouyin) {
    return {
      source: 'douyin',
      ok: true,
      items: [
        {
          title: '当前任务未指向抖音平台',
          snippet: `platform="${ctx.platform}" 且 query 中未出现「抖音/douyin」关键字，douyin 数据源跳过。如需调用，请把 platform 改为 douyin。`,
        },
      ],
    };
  }

  // Read whatever is already collected in the douyin-collector app's AppDataStore.
  // Real scraping is the responsibility of douyin-collector subscriptions; the
  // research runner reads, not writes, to avoid double-spending the user's
  // douyin anti-bot budget.
  let videos: DouyinVideoView[] = [];
  let storeError: string | undefined;
  try {
    videos = await loadDouyinVideosFromCollector();
  } catch (err) {
    storeError = err instanceof Error ? err.message : String(err);
  }

  const matched = matchVideosByQuery(videos, ctx.query).slice(0, 12);

  if (matched.length > 0) {
    return {
      source: 'douyin',
      ok: true,
      items: matched.map((v) => ({
        title: v.title || v.creator_nickname || `抖音视频 ${v.id.slice(0, 8)}`,
        url: v.aweme_id ? `https://www.douyin.com/video/${v.aweme_id}` : undefined,
        snippet: [
          v.creator_nickname ? `作者 ${v.creator_nickname}` : null,
          v.duration_seconds ? `时长 ${Math.round(v.duration_seconds)}s` : null,
          v.transcript_status ? `转写 ${v.transcript_status}` : null,
          v.library_status ? `入库 ${v.library_status}` : null,
          v.summary ? trimSnippet(v.summary, 160) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        meta: {
          aweme_id: v.aweme_id,
          creator: v.creator_nickname,
          creator_ref: v.creator_ref,
          duration_seconds: v.duration_seconds,
          transcript_status: v.transcript_status,
          library_status: v.library_status,
          cover: v.cover,
          updated_at: v.updated_at,
        },
      })),
    };
  }

  // No matches → surface onboarding guidance that's still actionable.
  const items: ResearchSourceItem[] = [];
  if (storeError) {
    items.push({
      title: '抖音采集器数据库不可用',
      snippet: `读取失败: ${storeError}。请确认 Lumos 桌面端在跑，并且抖音采集器应用已经初始化过一次。`,
    });
  } else if (videos.length === 0) {
    items.push({
      title: '抖音采集器还没有任何视频',
      snippet:
        '请到内置应用「抖音采集器」添加博主或关键词订阅，跑过几个 collect job 后，本任务就能读到真实数据。',
    });
  } else {
    items.push({
      title: `已采集 ${videos.length} 条抖音视频，但无 "${ctx.query}" 命中`,
      snippet: `匹配维度：tag / title / summary 子串模糊（不区分大小写）。可在「抖音采集器」检查是否有匹配主题的订阅。最近视频示例：${videos
        .slice(0, 3)
        .map((v) => v.title?.slice(0, 30) || '(无标题)')
        .join(' / ')}`,
    });
  }
  items.push({
    title: '补充思路',
    snippet: `关键词 "${ctx.query}" 可作为「抖音采集器 → 关键词订阅」的种子，建议时间窗 7 天 / 去重 3 天，先跑一轮观察热度分布再开自动巡更。`,
  });
  return { source: 'douyin', ok: true, items };
}

interface DouyinVideoView {
  id: string;
  aweme_id?: string | null;
  title?: string | null;
  creator_nickname?: string | null;
  creator_ref?: string | null;
  duration_seconds?: number | null;
  transcript_status?: string | null;
  library_status?: string | null;
  summary?: string | null;
  cover?: string | null;
  tags?: string | null;
  updated_at?: string | null;
}

async function loadDouyinVideosFromCollector(): Promise<DouyinVideoView[]> {
  const { getDouyinCollectorStore } = await import('@/lib/douyin-collector/storage');
  const { COLLECTION_VIDEOS } = await import('@/lib/douyin-collector/constants');
  const store = getDouyinCollectorStore();
  return store.query<DouyinVideoView>(COLLECTION_VIDEOS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 500,
  }) as DouyinVideoView[];
}

function matchVideosByQuery(videos: DouyinVideoView[], query: string): DouyinVideoView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  // Strip the literal word "douyin"/"抖音" from the haystack-needle decision so
  // a query like "抖音 礼物挂坠" effectively becomes "礼物挂坠".
  const cleaned = needle
    .replace(/douyin/gi, '')
    .replace(/抖音/g, '')
    .trim();
  const tokens = cleaned.length > 0 ? cleaned.split(/\s+/) : [needle];
  return videos.filter((v) => {
    const tags = parseTagsLoose(v.tags);
    const haystack = [
      v.title ?? '',
      v.summary ?? '',
      v.creator_nickname ?? '',
      ...tags,
    ]
      .join('\n')
      .toLowerCase();
    return tokens.some((tok) => tok && haystack.includes(tok));
  });
}

function parseTagsLoose(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === 'string');
  } catch {
    // fallthrough to comma/space split
  }
  return raw.split(/[,，\s]+/).filter(Boolean);
}

function trimSnippet(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

registerDefaultSources();
