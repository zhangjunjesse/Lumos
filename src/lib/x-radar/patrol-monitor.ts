/**
 * X 雷达 — 监控雷达 patrol 的真实抓取 + 规则匹配 + 写告警。
 *
 * 拆出来跟 patrol.ts 主入口分离：patrol.ts 管 cadence / dispatch / queue，
 * 本文件管 monitor 单任务里 X 抓取 → 套规则 → 写 radar_alerts + tweet_evidence 的实现。
 * 选题 / 摘要 / 拆解走 patrol-ai.ts。
 */

import type { AppDataStore, AppRow } from '@/lib/app/runtime/data-store';
import { sendAppImNotification } from '@/lib/app/im-notifications';
import { searchTweets } from '@/lib/x-platform/search';
import { readUserTweets } from '@/lib/x-platform/timeline';
import type { XSearchHit } from '@/lib/x-platform/types';
import { pushReportDocxIfEnabled } from './patrol-ai-helpers';
import type { PatrolInput, RadarTaskRow, TaskResult } from './patrol-types';

interface MonitorConfig {
  keywords?: string[];
  from_handles?: string[];
  exclude_keywords?: string[];
  window_hours?: number;
  min_like?: number;
  min_retweet?: number;
  search_mode?: 'Top' | 'Latest';
}

export async function runMonitor(
  task: AppRow<RadarTaskRow>,
  raw: Record<string, unknown>,
  store: AppDataStore,
  startedAt: string,
  input: PatrolInput,
): Promise<TaskResult> {
  const cfg = raw as MonitorConfig;
  const queries = (cfg.keywords ?? []).filter(Boolean);
  const handles = (cfg.from_handles ?? []).filter(Boolean);
  if (queries.length === 0 && handles.length === 0) {
    return { ok: false, reason: '未配置 keywords 或 from_handles', summary: '配置不完整，未跑抓取' };
  }
  const windowMs = (cfg.window_hours ?? 24) * 3600_000;
  const cutoff = Date.now() - windowMs;
  const mode = cfg.search_mode ?? 'Latest';

  const seen = new Map<string, XSearchHit>();
  for (const q of queries) {
    const r = await searchTweets(q, { count: 30, mode });
    for (const h of r.hits) {
      if (h.createdAt >= cutoff) seen.set(h.id, h);
    }
  }
  // D4 修：单 handle 抓失败不拖垮整个 task —— 跳过继续，单独记 failed handle
  const handleFailures: string[] = [];
  for (const h of handles) {
    try {
      const r = await readUserTweets(normalizeHandle(h), { count: 30 });
      for (const hit of r.hits) {
        if (hit.createdAt >= cutoff) seen.set(hit.id, hit);
      }
    } catch (err) {
      handleFailures.push(`@${h}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  let hits = Array.from(seen.values());
  const excludes = (cfg.exclude_keywords ?? []).map((w) => w.toLowerCase());
  if (excludes.length > 0) {
    hits = hits.filter((h) => !excludes.some((w) => h.text.toLowerCase().includes(w)));
  }
  const minLike = cfg.min_like ?? 0;
  const minRetweet = cfg.min_retweet ?? 0;
  hits = hits.filter((h) => h.likeCount >= minLike && h.retweetCount >= minRetweet);

  const newAlerts: { hit: XSearchHit; alertId: string }[] = [];
  for (const h of hits) {
    upsertEvidence(store, h, startedAt, { taskRef: task.id, kind: 'monitor' });
    const alreadyAlerted = store
      .query('radar_alerts', { filter: { tweet_id: h.id, task_ref: task.id }, limit: 1 })
      .length > 0;
    if (alreadyAlerted) continue;
    const created = store.create('radar_alerts', {
      task_ref: task.id,
      tweet_id: h.id,
      matched_rule: describeMatch(h, cfg),
      author_screen: h.authorScreenName,
      author_name: h.authorName,
      tweet_text: h.text,
      tweet_url: h.url,
      tweet_created_at: new Date(h.createdAt).toISOString(),
      like_count: h.likeCount,
      retweet_count: h.retweetCount,
      reply_count: h.replyCount,
      view_count: h.viewCount,
      status: 'pending',
      hit_at: startedAt,
      updated_at: startedAt,
    });
    newAlerts.push({ hit: h, alertId: created.id });
  }

  // P2 修：1 条告警 → 文本推（清爽）；≥2 条 → 合并成 docx 一次推（避免 N 条串行 + 微信刷屏）
  let pushed = 0;
  let pushFailed = 0;
  if (task.im_enabled === true && newAlerts.length > 0 && input.db && input.appId) {
    if (newAlerts.length === 1) {
      const { hit, alertId } = newAlerts[0];
      const result = await sendAppImNotification({
        db: input.db, appId: input.appId,
        title: `X 雷达命中：${task.name ?? '未命名监控'}`,
        text: formatAlertImText(task, hit, cfg),
        severity: 'info',
        target: { label: task.im_target_label || '默认微信用户' },
      }).catch((err) => ({ ok: false, status: 'failed' as const, appId: input.appId!, error: err instanceof Error ? err.message : String(err) }));
      if (result.ok) {
        pushed += 1;
        store.update('radar_alerts', alertId, {
          status: 'notified',
          notification_id: 'notificationId' in result ? (result.notificationId ?? '') : '',
          updated_at: startedAt,
        });
      } else { pushFailed += 1; }
    } else {
      // ≥2 条：合并成 docx 一次推
      const markdown = buildAlertsMarkdown(task, newAlerts.map((a) => a.hit), cfg);
      try {
        await pushReportDocxIfEnabled({
          task, patrolInput: input,
          title: `${task.name ?? '未命名监控'} 命中 ${newAlerts.length} 条`,
          subtitle: `扫描 ${seen.size} 条候选 · 命中 ${hits.length} 条 · 新增告警 ${newAlerts.length} 条`,
          metaLines: [`抓取时间：${new Date(startedAt).toLocaleString('zh-CN')}`],
          markdown,
        });
        // 假定 push 成功（pushReportDocxIfEnabled 内部 catch 静默；查 last_summary 看推送状态）
        // 全部 alerts 标记 notified
        for (const { alertId } of newAlerts) {
          store.update('radar_alerts', alertId, { status: 'notified', updated_at: startedAt });
        }
        pushed = newAlerts.length;
      } catch (err) {
        pushFailed = newAlerts.length;
        console.warn('[x-radar] push alerts docx failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  // D2 修：IM 推送 / handle 抓失败信息塞到 summary 里（last_summary 用户能看到），ok=true 保持
  const pushSuffix = pushed > 0 || pushFailed > 0 ? `；IM 推送 ${pushed} 成功 / ${pushFailed} 失败` : '';
  const handleFailSuffix = handleFailures.length > 0 ? `；${handleFailures.length} 个 handle 抓失败（${handleFailures[0]}）` : '';
  const summary = `扫 ${seen.size} 条候选，命中 ${hits.length} 条，新增告警 ${newAlerts.length} 条${pushSuffix}${handleFailSuffix}`;
  return { ok: true, reason: '', summary };
}

function buildAlertsMarkdown(task: AppRow<RadarTaskRow>, alerts: XSearchHit[], cfg: MonitorConfig): string {
  const lines: string[] = [];
  lines.push(`# ${task.name ?? '未命名监控'} 告警`);
  lines.push('');
  lines.push(`本批共 ${alerts.length} 条命中。每条含命中规则、作者、互动数和原推链接。`);
  lines.push('');
  for (const [idx, h] of alerts.entries()) {
    const tweetTime = new Date(h.createdAt).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    lines.push(`## ${idx + 1}. @${h.authorScreenName}（${h.authorName}）`);
    lines.push(`**命中规则**：${describeMatch(h, cfg)}  ·  **时间**：${tweetTime}`);
    lines.push(`**互动**：${h.likeCount} 赞 / ${h.retweetCount} 转 / ${h.replyCount} 评 / ${h.viewCount} 看`);
    lines.push('');
    lines.push(h.text);
    lines.push('');
    lines.push(`[在 X 查看原推](${h.url})`);
    lines.push('');
  }
  return lines.join('\n');
}

function formatAlertImText(task: AppRow<RadarTaskRow>, h: XSearchHit, cfg: MonitorConfig): string {
  // D8 修：时间用中文本地格式而非 ISO UTC（微信用户看不懂 2025-05-21T14:34:00.000Z）
  const tweetTime = new Date(h.createdAt).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return [
    `命中规则：${describeMatch(h, cfg)}`,
    `作者：@${h.authorScreenName}（${h.authorName}）`,
    `时间：${tweetTime}`,
    `互动：${h.likeCount}赞 / ${h.retweetCount}转 / ${h.replyCount}评`,
    `链接：${h.url}`,
    '',
    h.text.length > 280 ? h.text.slice(0, 280) + '…' : h.text,
  ].join('\n');
}

function normalizeHandle(s: string): string {
  return s.trim().replace(/^@/, '').toLowerCase();
}

function describeMatch(h: XSearchHit, cfg: MonitorConfig): string {
  const parts: string[] = [];
  if ((cfg.keywords ?? []).some((k) => h.text.toLowerCase().includes(k.toLowerCase()))) parts.push('keyword');
  // B3 修：去 @ + lowercase 后再比，避免用户填「@OpenAI」时大小写或 @ 前缀不匹配
  const handlesNorm = (cfg.from_handles ?? []).map(normalizeHandle);
  if (handlesNorm.includes(normalizeHandle(h.authorScreenName))) {
    parts.push(`from:@${h.authorScreenName}`);
  }
  if (cfg.min_like && h.likeCount >= cfg.min_like) parts.push(`likes≥${cfg.min_like}`);
  if (cfg.min_retweet && h.retweetCount >= cfg.min_retweet) parts.push(`retweets≥${cfg.min_retweet}`);
  return parts.join(' / ') || 'matched';
}

interface EvidenceContext {
  taskRef: string;
  kind: 'monitor' | 'topic' | 'digest' | 'stats';
}

export function upsertEvidence(
  store: AppDataStore,
  h: XSearchHit,
  snapshotAt: string,
  ctx?: EvidenceContext,
): void {
  const existing = store.get('tweet_evidence', h.id);
  const row = {
    author_screen: h.authorScreenName,
    author_name: h.authorName,
    text: h.text,
    tweet_created_at: new Date(h.createdAt).toISOString(),
    like_count: h.likeCount,
    retweet_count: h.retweetCount,
    reply_count: h.replyCount,
    view_count: h.viewCount,
    quote_count: h.quoteCount,
    url: h.url,
    conversation_id: h.conversationId,
    photos_json: JSON.stringify(h.photoUrls ?? []),
    video_previews_json: JSON.stringify(h.videoPreviewUrls ?? []),
    snapshot_at: snapshotAt,
    updated_at: snapshotAt,
  };
  if (existing) store.update('tweet_evidence', h.id, row);
  else store.create('tweet_evidence', { id: h.id, ...row });

  // 写 task → tweet 的引用关系（B1: upsert 而不是无脑 create，避免同任务跑 N 次后 refs 表 N 倍膨胀）
  if (ctx) {
    const existingRefs = store.query<{ task_ref?: string; tweet_id?: string }>('task_evidence_refs', {
      filter: { task_ref: ctx.taskRef, tweet_id: h.id }, limit: 1,
    });
    if (existingRefs.length > 0) {
      store.update('task_evidence_refs', existingRefs[0].id, { matched_at: snapshotAt });
    } else {
      store.create('task_evidence_refs', {
        task_ref: ctx.taskRef,
        tweet_id: h.id,
        matched_at: snapshotAt,
        kind: ctx.kind,
      });
    }
  }
}
