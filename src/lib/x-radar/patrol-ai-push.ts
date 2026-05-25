/**
 * X 雷达报告 IM 推送：渲染（poster / image / docx）+ 微信发附件。
 * 从 patrol-ai-helpers.ts 拆出来，控制单文件 ≤ 300 行。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';

import type { AppRow } from '@/lib/app/runtime/data-store';
import { sendAppImNotification } from '@/lib/app/im-notifications';

import { renderReportDocx } from './report-docx';
import { renderReportImage, type ReportStyle } from './report-image';
import { renderReportPoster } from './report-poster';
import type { ReportPosterData } from './report-schema';
import type { PatrolInput, RadarTaskRow } from './patrol-types';

export type ReportFormat = 'poster' | 'image' | 'docx';

async function renderByFormat(args: {
  format: ReportFormat;
  style: ReportStyle;
  title: string; subtitle?: string; metaLines?: string[];
  markdown: string;
  poster?: ReportPosterData;
}): Promise<{ buffer: Buffer; ext: string; mime: string }> {
  const { format, style, title, subtitle, metaLines, markdown, poster } = args;
  // poster 优先：有 structured 数据就走海报渲染
  if (format === 'poster' && poster) {
    const buffer = await renderReportPoster({
      hook: poster.hook, title, subtitle, metaLines,
      kpis: poster.kpis, insight: poster.insight,
      quotes: poster.quotes, actions: poster.actions,
      style,
    });
    return { buffer, ext: 'png', mime: 'image/png' };
  }
  // 无 poster 数据但选了 poster → 兜底走 image 长图（防止用户切到 poster 但 LLM 失败拿不到结构化）
  if (format === 'image' || format === 'poster') {
    const buffer = await renderReportImage({ title, subtitle, metaLines, markdown, style });
    return { buffer, ext: 'png', mime: 'image/png' };
  }
  const buffer = await renderReportDocx({ title, subtitle, metaLines, markdown });
  return { buffer, ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
}

/**
 * 报告生成完后如果 task.im_enabled=true，按 task.report_format 渲染 + 推送。
 * 默认 poster（海报），可选 image / docx。task.report_style 控制图片样式（minimal/business/magazine/dark）。
 * 失败不影响 task 成功状态（产物已落库），只在日志记一笔。
 */
export interface PushReportResult {
  /** 推送状态：sent=成功 / failed=失败 / skipped=条件不满足跳过 */
  status: 'sent' | 'failed' | 'skipped';
  reason?: string;
  format?: ReportFormat;
}

export async function pushReportIfEnabled(args: {
  task: AppRow<RadarTaskRow>;
  patrolInput: PatrolInput;
  title: string;
  subtitle?: string;
  metaLines?: string[];
  markdown: string;
  /** structured poster 数据（来自 callStructuredReport）。format=poster 时走这条路径。 */
  poster?: ReportPosterData;
}): Promise<PushReportResult> {
  const { task, patrolInput, title, subtitle, metaLines, markdown, poster } = args;
  if (task.im_enabled !== true) return { status: 'skipped', reason: '未开启 IM 推送' };
  if (!patrolInput.db || !patrolInput.appId) return { status: 'skipped', reason: '缺少 db 或 appId 上下文' };
  // 内容空判断：poster 有 hook 也算有内容；markdown 非空也算
  const hasContent = (markdown && markdown.trim().length > 0) || (poster && poster.hook.trim().length > 0);
  if (!hasContent) return { status: 'skipped', reason: '报告内容为空' };

  // 默认 poster（海报），向后兼容 image / docx
  const reqFormat = task.report_format as string | undefined;
  const format: ReportFormat = reqFormat === 'docx' ? 'docx' : reqFormat === 'image' ? 'image' : 'poster';
  const validStyles = ['minimal', 'business', 'magazine', 'dark'] as const;
  const style: ReportStyle = validStyles.includes(task.report_style as ReportStyle)
    ? (task.report_style as ReportStyle) : 'business';

  const tmpDir = path.join(os.tmpdir(), 'lumos-x-radar-reports');
  let filePath: string | null = null;
  try {
    const rendered = await renderByFormat({ format, style, title, subtitle, metaLines, markdown, poster });
    fs.mkdirSync(tmpDir, { recursive: true });
    const safeName = `${title.replace(/[^一-龥\w-]+/g, '_').slice(0, 50)}.${rendered.ext}`;
    filePath = path.join(tmpDir, `${Date.now()}-${safeName}`);
    fs.writeFileSync(filePath, rendered.buffer);

    const result = await sendAppImNotification({
      db: patrolInput.db as Database.Database,
      appId: patrolInput.appId,
      title: `X 雷达：${title}`,
      text: `${subtitle ?? ''}\n详情见附件。`.trim(),
      target: { label: task.im_target_label || '默认微信用户' },
      attachments: [{
        name: safeName, type: rendered.mime, size: rendered.buffer.length, filePath,
      }],
    });
    if (!result.ok) {
      return { status: 'failed', reason: result.error ?? '微信推送失败（未知原因）', format };
    }
    return { status: 'sent', format };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[x-radar] push report failed:', reason);
    return { status: 'failed', reason, format };
  } finally {
    if (filePath) { try { fs.unlinkSync(filePath); } catch { /* ignore */ } }
    try { cleanupOldReports(tmpDir); } catch { /* ignore */ }
  }
}

/** 向后兼容旧名，内部 dispatch 走 task.report_format（默认 poster）。 */
export const pushReportDocxIfEnabled = pushReportIfEnabled;

/** summary 后缀：把 IM 推送结果嵌进 task.last_summary 让用户能看到失败原因。 */
export function formatPushSuffix(result: PushReportResult): string {
  if (result.status === 'sent') {
    const label = result.format === 'poster' ? '海报' : result.format === 'image' ? 'PNG 长图' : 'docx';
    return `；已推 ${label} 到微信`;
  }
  if (result.status === 'failed') return `；IM 推送失败（${result.reason?.slice(0, 80) ?? '未知'}）`;
  if (result.status === 'skipped' && result.reason !== '未开启 IM 推送') return `；IM 跳过（${result.reason}）`;
  return '';
}

function cleanupOldReports(tmpDir: string): void {
  if (!fs.existsSync(tmpDir)) return;
  const cutoff = Date.now() - 60 * 60_000;
  for (const name of fs.readdirSync(tmpDir)) {
    if (!/\.(docx|png)$/.test(name)) continue;
    const full = path.join(tmpDir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
    } catch { /* skip */ }
  }
}
