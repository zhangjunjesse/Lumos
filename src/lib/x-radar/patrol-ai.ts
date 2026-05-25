/**
 * X 雷达 — 选题挖掘 / 关注摘要 / 数据拆解的 AI 报告生成。
 *
 * 走 Lumos 通用 text-generator（resolveProviderForCapability + generateTextFromProvider）。
 * Provider / model 不可用时如实写 failure_reason，不冒充 success。
 */

import type { AppDataStore, AppRow } from '@/lib/app/runtime/data-store';
import { searchTweets } from '@/lib/x-platform/search';
import { readUserTweets } from '@/lib/x-platform/timeline';
import { readTweetReplies } from '@/lib/x-platform/thread';
import type { XSearchHit } from '@/lib/x-platform/types';
import { upsertEvidence } from './patrol-monitor';
import {
  buildDigestPrompt, buildStatsPrompt, buildTopicPrompt,
  callReportWithMarkdownFallback, fmtDate, formatPushSuffix, pushReportIfEnabled,
} from './patrol-ai-helpers';
import type { ReportPosterData } from './report-schema';
import type { PatrolInput, RadarTaskRow, TaskResult } from './patrol-types';

interface TopicConfig { topic?: string; queries?: string[]; max_fetch?: number; thread_extract_count?: number; }
interface DigestConfig { handles?: string[]; window_kind?: 'daily' | 'weekly'; per_handle_count?: number; }
interface StatsConfig { target_kind?: 'handle' | 'topic'; target?: string; sample_days?: number; top_threads_count?: number; }

/** 简单 concurrency 限制：分批跑 items, 每批 size 个并发，跑完一批继续下一批。 */
async function runWithConcurrency<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

/** 把 structured poster 数据回写为 markdown，存进 DB（report_md 字段沿用旧 schema）+ 用户在
 * 任务详情页面里能看到可读文本。 */
function renderPosterToMarkdown(p: ReportPosterData): string {
  const lines: string[] = [];
  lines.push(`# ${p.hook}\n`);
  if (p.kpis.length > 0) {
    lines.push('## 核心数字\n');
    for (const k of p.kpis) lines.push(`- **${k.value}** ${k.label}`);
    lines.push('');
  }
  lines.push(p.insight);
  if (p.quotes.length > 0) {
    lines.push('\n## 金句\n');
    for (const q of p.quotes) {
      const u = q.url ? ` ([原推](${q.url}))` : '';
      lines.push(`> ${q.text}\n>\n> — @${q.author}${u}\n`);
    }
  }
  if (p.actions.length > 0) {
    lines.push('## 下一步行动\n');
    p.actions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
  }
  return lines.join('\n');
}

export async function runTopic(
  task: AppRow<RadarTaskRow>,
  raw: Record<string, unknown>,
  store: AppDataStore,
  startedAt: string,
  patrolInput: PatrolInput,
): Promise<TaskResult> {
  const cfg = raw as TopicConfig;
  const queries = [cfg.topic, ...(cfg.queries ?? [])].filter(Boolean) as string[];
  if (queries.length === 0) return { ok: false, reason: '未配置 topic 或 queries', summary: '配置不完整' };
  const maxFetch = cfg.max_fetch ?? 50;
  const seen = new Map<string, XSearchHit>();
  for (const q of queries) {
    const r = await searchTweets(q, { count: Math.min(50, maxFetch) });
    for (const h of r.hits) seen.set(h.id, h);
    if (seen.size >= maxFetch) break;
  }
  for (const h of Array.from(seen.values())) upsertEvidence(store, h, startedAt, { taskRef: task.id, kind: 'topic' });

  const threadCount = Math.min(cfg.thread_extract_count ?? 20, seen.size);
  const sorted = Array.from(seen.values())
    .sort((a, b) => (b.likeCount + b.retweetCount) - (a.likeCount + a.retweetCount))
    .slice(0, threadCount);
  // P2 修：thread 抽取并发度 3，比串行快 3x；X 限流敏感故不直接 all-at-once
  await runWithConcurrency(sorted, 3, async (h) => {
    const replies = await readTweetReplies(h.conversationId || h.id, { count: 10 }).catch(() => ({ hits: [] }));
    for (const r of replies.hits) upsertEvidence(store, r, startedAt, { taskRef: task.id, kind: 'topic' });
  });

  const sources = Array.from(seen.values()).slice(0, 50).map((h) => ({
    url: h.url, author: h.authorScreenName, text: h.text.slice(0, 200),
    created_at: new Date(h.createdAt).toISOString(),
  }));

  const { system, prompt } = buildTopicPrompt({
    topic: cfg.topic ?? queries[0],
    queries, evidenceCount: seen.size, sources,
  });
  const ai = await callReportWithMarkdownFallback(system, prompt);
  let fatalError = '', degradeNote = '', reportMd = '';
  let poster: ReportPosterData | null = null;
  if ('error' in ai) { fatalError = ai.error; } else {
    poster = ai.poster; degradeNote = ai.failureReason;
    reportMd = poster ? renderPosterToMarkdown(poster) : ai.markdown;
  }

  store.create('topic_reports', {
    task_ref: task.id,
    topic: cfg.topic ?? queries[0],
    report_md: reportMd,
    report_json: poster ? JSON.stringify(poster) : '',
    sources_json: JSON.stringify(sources),
    evidence_count: seen.size,
    library_status: 'unprocessed',
    failure_reason: fatalError || degradeNote,
    created_at: startedAt,
    updated_at: startedAt,
  });

  if (fatalError) return { ok: false, reason: fatalError, summary: `证据 ${seen.size} 条已落库；${fatalError}` };

  const pushResult = await pushReportIfEnabled({
    task, patrolInput,
    title: `选题挖掘：${cfg.topic ?? queries[0]}`,
    subtitle: `${seen.size} 条原推证据 · 查询：${queries.join(' / ')}`,
    metaLines: [`生成时间：${new Date(startedAt).toLocaleString('zh-CN')}`],
    markdown: reportMd, poster: poster ?? undefined,
  });

  const degradeSuffix = degradeNote ? `；${degradeNote.slice(0, 80)}` : '';
  return { ok: true, reason: '', summary: `证据 ${seen.size} 条 + 报告 ${reportMd.length} 字符${degradeSuffix}${formatPushSuffix(pushResult)}` };
}

export async function runDigest(
  task: AppRow<RadarTaskRow>,
  raw: Record<string, unknown>,
  store: AppDataStore,
  startedAt: string,
  patrolInput: PatrolInput,
): Promise<TaskResult> {
  const cfg = raw as DigestConfig;
  const handles = (cfg.handles ?? []).filter(Boolean);
  if (handles.length === 0) return { ok: false, reason: '未配置 handles', summary: '配置不完整' };
  const windowKind = cfg.window_kind ?? 'daily';
  const windowMs = (windowKind === 'weekly' ? 7 : 1) * 24 * 3600_000;
  const cutoff = Date.now() - windowMs;
  const perHandle = cfg.per_handle_count ?? 10;
  const accounts: { handle: string; tweet_count: number; tweets: XSearchHit[] }[] = [];
  const handleFailures: string[] = [];
  let totalTweets = 0;
  // D4 修：单 handle 抓失败不拖垮整个 task — 跳过继续，收集失败列表
  for (const h of handles) {
    try {
      const r = await readUserTweets(h.trim().replace(/^@/, ''), { count: perHandle });
      const inWindow = r.hits.filter((hit) => hit.createdAt >= cutoff);
      for (const hit of inWindow) upsertEvidence(store, hit, startedAt, { taskRef: task.id, kind: 'digest' });
      accounts.push({ handle: h, tweet_count: inWindow.length, tweets: inWindow });
      totalTweets += inWindow.length;
    } catch (err) {
      handleFailures.push(`@${h}: ${err instanceof Error ? err.message : String(err)}`);
      accounts.push({ handle: h, tweet_count: 0, tweets: [] }); // 占位，避免 LLM prompt 缺这个 handle
    }
  }

  const { system, prompt } = buildDigestPrompt({
    windowKind, cutoffMs: cutoff, endMs: Date.parse(startedAt),
    handles, totalTweets, accounts,
  });
  const ai = await callReportWithMarkdownFallback(system, prompt);
  let fatalError = '', degradeNote = '', summaryMd = '';
  let poster: ReportPosterData | null = null;
  if ('error' in ai) { fatalError = ai.error; } else {
    poster = ai.poster; degradeNote = ai.failureReason;
    summaryMd = poster ? renderPosterToMarkdown(poster) : ai.markdown;
  }

  const accountsJson = JSON.stringify(accounts.map((a) => ({ handle: a.handle, tweet_count: a.tweet_count })));
  store.create('follow_digests', {
    task_ref: task.id,
    window_kind: windowKind,
    window_start: new Date(cutoff).toISOString(),
    window_end: startedAt,
    summary_md: summaryMd,
    report_json: poster ? JSON.stringify(poster) : '',
    accounts_json: accountsJson,
    account_count: handles.length,
    tweet_count: totalTweets,
    library_status: 'unprocessed',
    failure_reason: fatalError || degradeNote,
    updated_at: startedAt,
  });

  const failSuffix = handleFailures.length > 0 ? `；${handleFailures.length} 个 handle 抓失败（${handleFailures[0]}）` : '';

  if (fatalError) return { ok: false, reason: fatalError, summary: `${handles.length} 账号 / ${totalTweets} 推已抓取；${fatalError}${failSuffix}` };

  const pushResult = await pushReportIfEnabled({
    task, patrolInput,
    title: `关注摘要：${task.name || '未命名'}`,
    subtitle: `${windowKind === 'weekly' ? '周报' : '日报'} · ${handles.length} 账号 / ${totalTweets} 条原推`,
    metaLines: [
      `窗口：${fmtDate(cutoff)} → ${fmtDate(Date.parse(startedAt))}`,
      `账号：@${handles.join('、@')}`,
    ],
    markdown: summaryMd, poster: poster ?? undefined,
  });

  const degradeSuffix = degradeNote ? `；${degradeNote.slice(0, 80)}` : '';
  return { ok: true, reason: '', summary: `${handles.length} 账号 / ${totalTweets} 推 + 摘要 ${summaryMd.length} 字符${failSuffix}${degradeSuffix}${formatPushSuffix(pushResult)}` };
}

export async function runStats(
  task: AppRow<RadarTaskRow>,
  raw: Record<string, unknown>,
  store: AppDataStore,
  startedAt: string,
  patrolInput: PatrolInput,
): Promise<TaskResult> {
  const cfg = raw as StatsConfig;
  const target = (cfg.target ?? '').trim();
  if (!target) return { ok: false, reason: '未配置 target', summary: '配置不完整' };
  const sampleDays = cfg.sample_days ?? 14;
  const cutoff = Date.now() - sampleDays * 24 * 3600_000;
  const targetKind = cfg.target_kind ?? 'handle';
  const hits: XSearchHit[] = [];
  let rawCount = 0;
  // D4 修：抓 X 失败用 reason 返回 task fail，不抛异常拖崩 patrol
  try {
    if (targetKind === 'handle') {
      const r = await readUserTweets(target.replace(/^@/, ''), { count: 100 });
      rawCount = r.hits.length;
      hits.push(...r.hits.filter((h) => h.createdAt >= cutoff));
    } else {
      const r = await searchTweets(target, { count: 100, mode: 'Latest' });
      rawCount = r.hits.length;
      hits.push(...r.hits.filter((h) => h.createdAt >= cutoff));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg, summary: `抓取失败：${msg.slice(0, 100)}` };
  }
  for (const h of hits) upsertEvidence(store, h, startedAt, { taskRef: task.id, kind: 'stats' });
  if (hits.length < 10) {
    return { ok: false, reason: `样本不足（n=${hits.length}）`, summary: `仅 ${hits.length} 条原推，需扩大 sample_days 或目标` };
  }
  // D5 修：X scraper count 上限 100。如果抓满 100 条且窗口 > 7 天，样本可能不覆盖全窗口 — 如实告知
  const sampleTruncated = rawCount >= 100 && sampleDays > 7;
  const totalLike = hits.reduce((s, h) => s + h.likeCount, 0);
  const totalRetweet = hits.reduce((s, h) => s + h.retweetCount, 0);
  const totalReply = hits.reduce((s, h) => s + h.replyCount, 0);
  const totalView = hits.reduce((s, h) => s + h.viewCount, 0);
  const metrics = {
    tweet_count: hits.length,
    avg_like: hits.length ? Math.round(totalLike / hits.length) : 0,
    avg_retweet: hits.length ? Math.round(totalRetweet / hits.length) : 0,
    avg_reply: hits.length ? Math.round(totalReply / hits.length) : 0,
    engagement_rate: totalView > 0 ? Number(((totalLike + totalRetweet + totalReply) / totalView).toFixed(4)) : null,
    sample_days: sampleDays,
    sample_truncated: sampleTruncated, // D5：true 时表示样本可能没覆盖全窗口
  };
  const topThreads = [...hits]
    .sort((a, b) => (b.likeCount + b.retweetCount) - (a.likeCount + a.retweetCount))
    .slice(0, cfg.top_threads_count ?? 5)
    .map((h) => ({ tweet_id: h.id, author: h.authorScreenName, text: h.text.slice(0, 200), like_count: h.likeCount, retweet_count: h.retweetCount, url: h.url }));

  const { system, prompt } = buildStatsPrompt({ target, targetKind, sampleDays, metrics, topThreads });
  const ai = await callReportWithMarkdownFallback(system, prompt);
  let fatalError = '', degradeNote = '', reportMd = '';
  let poster: ReportPosterData | null = null;
  if ('error' in ai) { fatalError = ai.error; } else {
    poster = ai.poster; degradeNote = ai.failureReason;
    reportMd = poster ? renderPosterToMarkdown(poster) : ai.markdown;
  }

  store.create('stats_reports', {
    task_ref: task.id,
    target,
    metrics_json: JSON.stringify(metrics),
    top_threads_json: JSON.stringify(topThreads),
    report_md: reportMd,
    report_json: poster ? JSON.stringify(poster) : '',
    sample_start: new Date(cutoff).toISOString(),
    sample_end: startedAt,
    failure_reason: fatalError || degradeNote,
    created_at: startedAt,
    updated_at: startedAt,
  });

  if (fatalError) return { ok: false, reason: fatalError, summary: `指标已算 (n=${hits.length})；${fatalError}` };

  const pushResult = await pushReportIfEnabled({
    task, patrolInput,
    title: `数据拆解：${target}`,
    subtitle: `${targetKind === 'topic' ? '话题' : '账号'} · 采样 ${sampleDays} 天 / ${hits.length} 条原推`,
    metaLines: [`采样窗口：${fmtDate(cutoff)} → ${fmtDate(Date.parse(startedAt))}`],
    markdown: reportMd, poster: poster ?? undefined,
  });

  const truncSuffix = sampleTruncated ? `；样本可能截断（X scraper 上限 100 条，但配了 ${sampleDays} 天窗口）` : '';
  const degradeSuffix = degradeNote ? `；${degradeNote.slice(0, 80)}` : '';
  return { ok: true, reason: '', summary: `指标已算 (n=${hits.length}) + 报告 ${reportMd.length} 字符${truncSuffix}${degradeSuffix}${formatPushSuffix(pushResult)}` };
}
