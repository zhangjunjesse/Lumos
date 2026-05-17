/**
 * web 数据源 adapter：对调研主题做一次公开网络知识检索（真实数据）。
 *
 * 「调研」= 选题/知识研究：query 是研究主题，不是某平台的商品关键词。因此
 * **不**拼 marketplace 商品搜索 URL、**不**抓 etsy/amazon 商品页（那是
 * discover/选品 的职责）。SERP 取数走内置浏览器 bridge（后台模式，见
 * research-web-knowledge），避免服务端裸 fetch 被搜索引擎 403。platform
 * 仅作研究上下文词。单向依赖 research-sources（契约/notice）。
 */

import { getBrowserFetchSettings } from './discover-settings';
import { getResearchStore } from './research-storage';
import {
  notice,
  trimSnippet,
  type ResearchSourceContext,
  type ResearchSourceItem,
  type ResearchSourceResult,
} from './research-sources';

const WEB_MAX_RESULTS = 12;

export async function webAdapter(ctx: ResearchSourceContext): Promise<ResearchSourceResult> {
  // Dynamic import keeps the registry module side-effect-free at load time.
  const { fetchTopicKnowledge } = await import('./research-web-knowledge');

  // 复用用户的浏览器抓取设置（默认=内置浏览器，已启用）；SERP 走真实浏览器
  // 才不会被搜索引擎当服务端机器人 403。
  const browserSettings = getBrowserFetchSettings(getResearchStore());

  const out = await fetchTopicKnowledge({
    query: ctx.query,
    platform: ctx.platform,
    signal: ctx.signal,
    maxResults: WEB_MAX_RESULTS,
    browserSettings,
  });

  const items: ResearchSourceItem[] = out.items.map((it) => ({
    title: it.title,
    url: it.url,
    snippet: it.snippet ? trimSnippet(it.snippet, 240) : undefined,
  }));

  if (items.length === 0) {
    // 零数据如实写原因（notice 不计真实数据，不喂 LLM 当发现）。
    return {
      source: 'web',
      ok: true,
      items: [
        notice(
          '主题检索未获得数据',
          `${out.warning ?? '未知原因'}（检索词："${out.searchQuery}"）`,
        ),
      ],
    };
  }

  return { source: 'web', ok: true, items };
}
