import type { AdapterContext, AdapterAccountDataItem, AdapterAccountDataResult } from '../adapter-types';

// ---------------------------------------------------------------------------
// API response shape — /api/v4/unify-consumption/read_history
// ---------------------------------------------------------------------------

interface ZhihuReadHistoryCard {
  card_type: string;
  data: {
    header?: { title?: string };
    content?: { author_name?: string; summary?: string };
    action?: { type?: string; url?: string };
    extra?: {
      content_token?: string;
      content_type?: string;
      read_time?: number;
      question_token?: string;
    };
  };
}

interface ZhihuReadHistoryResponse {
  data?: ZhihuReadHistoryCard[];
  paging?: { is_end?: boolean; totals?: number };
  error?: { code?: number; message?: string };
}

// ---------------------------------------------------------------------------
// Browse history fetch
// ---------------------------------------------------------------------------

export async function fetchZhihuBrowseHistory(
  ctx: AdapterContext,
  limit: number,
): Promise<AdapterAccountDataResult> {
  const apiUrl = `https://www.zhihu.com/api/v4/unify-consumption/read_history?offset=0&limit=${limit}`;
  const resp = await ctx.fetch(apiUrl, {
    headers: { Referer: 'https://www.zhihu.com/recent-viewed' },
  });

  let parsed: ZhihuReadHistoryResponse;
  try {
    parsed = JSON.parse(resp.html) as ZhihuReadHistoryResponse;
  } catch {
    throw new Error('知乎浏览历史接口返回非 JSON 数据，可能未登录或接口变更');
  }

  if (parsed.error) {
    throw new Error(`知乎接口错误 ${parsed.error.code ?? ''}: ${parsed.error.message ?? '未知错误'}`);
  }

  const cards = parsed.data ?? [];
  const items: AdapterAccountDataItem[] = cards
    .map((card): AdapterAccountDataItem | null => {
      const d = card.data;
      const title = d.header?.title ?? '';
      const url = d.action?.url ?? '';
      if (!title || !url) return null;

      const contentType = d.extra?.content_type ?? 'unknown';
      const readTime = d.extra?.read_time;
      const viewedAt = readTime ? new Date(readTime * 1000).toISOString() : '';
      const snippet = d.content?.summary?.slice(0, 200) ?? '';

      return {
        id: d.extra?.content_token ?? '',
        type: contentType,
        title,
        url,
        viewedAt,
        snippet: snippet || undefined,
      };
    })
    .filter((item): item is AdapterAccountDataItem => item !== null);

  return {
    dataType: 'browse_history',
    items,
    hasMore: parsed.paging?.is_end === false,
    total: parsed.paging?.totals,
  };
}
