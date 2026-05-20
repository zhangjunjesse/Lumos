/**
 * douyin 数据源 adapter：只读抖音采集器已采集的视频（真实数据），
 * 非抖音任务 / 空库 / 无命中 / 读取失败走 notice（不冒充数据，不触发采集）。
 */

import {
  notice,
  trimSnippet,
  type ResearchSourceContext,
  type ResearchSourceItem,
  type ResearchSourceResult,
} from './research-sources';

export async function douyinAdapter(
  ctx: ResearchSourceContext,
): Promise<ResearchSourceResult> {
  const wantsDouyin =
    ctx.platform.toLowerCase() === 'douyin' || /抖音|douyin/i.test(ctx.query);
  if (!wantsDouyin) {
    return {
      source: 'douyin',
      ok: true,
      items: [
        notice(
          '当前任务未指向抖音平台',
          `platform="${ctx.platform}" 且 query 中未出现「抖音/douyin」关键字，douyin 数据源跳过。如需调用，请把 platform 改为 douyin。`,
        ),
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
    items.push(
      notice(
        '抖音采集器数据库不可用',
        `读取失败: ${storeError}。请确认 Lumos 桌面端在跑，并且抖音采集器应用已经初始化过一次。`,
      ),
    );
  } else if (videos.length === 0) {
    items.push(
      notice(
        '抖音采集器还没有任何视频',
        '请到内置应用「抖音采集器」添加博主或关键词订阅，跑过几个 collect job 后，本任务就能读到真实数据。',
      ),
    );
  } else {
    items.push(
      notice(
        `已采集 ${videos.length} 条抖音视频，但无 "${ctx.query}" 命中`,
        `匹配维度：tag / title / summary 子串模糊（不区分大小写）。可在「抖音采集器」检查是否有匹配主题的订阅。最近视频示例：${videos
          .slice(0, 3)
          .map((v) => v.title?.slice(0, 30) || '(无标题)')
          .join(' / ')}`,
      ),
    );
  }
  items.push(
    notice(
      '补充思路',
      `关键词 "${ctx.query}" 可作为「抖音采集器 → 关键词订阅」的种子，建议时间窗 7 天 / 去重 3 天，先跑一轮观察热度分布再开自动巡更。`,
    ),
  );
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
