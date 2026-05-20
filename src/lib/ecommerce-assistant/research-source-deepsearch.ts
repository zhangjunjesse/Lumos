/**
 * deepsearch 数据源 adapter：匹配已配置 DeepSearch 站点 + 近期 run（真实数据），
 * 无匹配 / 读取失败 / 深挖建议走 notice（不冒充数据）。
 */

import {
  notice,
  trimSnippet,
  type ResearchSourceContext,
  type ResearchSourceItem,
  type ResearchSourceResult,
} from './research-sources';

export async function deepsearchAdapter(
  ctx: ResearchSourceContext,
): Promise<ResearchSourceResult> {
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

  // 调研=选题/知识研究：DeepSearch 是知识检索引擎，**不**按 platform 名筛站
  // 点（旧逻辑用 key/name.includes(platform) 把 "etsy" 这类电商平台名当过滤
  // 词，导致选题调研被整体挡掉——正是用户实测的「逻辑不清晰」根因）。所有
  // 已配置站点都是可用知识渠道，相关性靠下面按 query 主题匹配近期 run 体现。
  const matched = sites;

  if (sites.length === 0) {
    return {
      source: 'deepsearch',
      ok: true,
      items: [
        notice(
          '还没有配置 DeepSearch 站点',
          '当前没有任何 DeepSearch 站点。请到「设置 → DeepSearch」添加站点并完成登录验证后，再回到此处重新跑调研。',
        ),
      ],
    };
  }

  // 匹配到的站点是「可用调研渠道 + 登录态」清单，属能力/状态，**不是调研
  // 数据** → notice，不计入真实条目、不喂 LLM 当发现。真正的数据是下面的
  // DeepSearch run 产物（已实际抓取的结果）。
  const items: ResearchSourceItem[] = matched.map((site) =>
    notice(
      site.displayName || site.siteKey,
      [
        `siteKey=${site.siteKey}`,
        `cookieStatus=${site.cookieStatus}`,
        site.hasCookie ? 'cookie 已配置' : 'cookie 未配置',
        site.lastValidatedAt ? `最近校验 ${site.lastValidatedAt}` : '未校验',
      ].join(' · '),
    ),
  );

  // Pull recent completed runs whose queryText overlaps the research topic —
  // those are real researched artifacts we can reference. 不再用 siteOverlap：
  // 站点已不按 platform 过滤，"碰过任意站点" 对每个 run 几乎恒真，会把无关
  // run 当相关；选题调研的相关性只认 query 主题重叠。
  try {
    const { listDeepSearchRunsView } = await import('@/lib/deepsearch/service');
    const runs = await listDeepSearchRunsView(50);
    const needle = ctx.query.trim().toLowerCase();
    const relatedRuns = runs.filter((run) => {
      const status = String(run.status ?? '').toLowerCase();
      if (status === 'failed' || status === 'cancelled') return false;
      return needle.length > 0 && String(run.queryText ?? '').toLowerCase().includes(needle);
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
    items.push(
      notice('⚠️ 无法读取最近 DeepSearch run', err instanceof Error ? err.message : String(err)),
    );
  }

  // We intentionally don't kick off a deepsearch run here — those are
  // multi-minute jobs the user reviews in the dedicated DeepSearch tab.
  items.push(
    notice(
      '继续深挖建议',
      '到「设置 → DeepSearch」选中以上 siteKey 启动一次正式 deepsearch run（多分钟级），run 完成后下次本任务能在「DeepSearch run」段引用结果。',
    ),
  );

  return { source: 'deepsearch', ok: true, items };
}
