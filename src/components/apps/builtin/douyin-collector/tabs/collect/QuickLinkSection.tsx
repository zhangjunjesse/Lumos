'use client';

import * as React from 'react';
import { Loader2, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import type { useJobs } from '../../use-jobs';

/**
 * Round 163: this is the PRIMARY working path now (creator + hashtag
 * auto-patrol both blocked by douyin anti-bot per Rounds 160/161).
 * Upgraded from a single-line input to a textarea so users can paste
 * a batch they collected by hand on douyin.com. Each non-empty line
 * is enqueued as its own link job; per-line failures don't block the
 * rest.
 */
export function QuickLinkSection({
  jobs,
}: {
  jobs: ReturnType<typeof useJobs>;
}): React.ReactElement {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);

  // Auto-clear feedback after 8s — same pattern as MaintenanceSection.
  React.useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), 8000);
    return () => clearTimeout(id);
  }, [feedback]);

  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  async function onCollect() {
    if (lines.length === 0) return;
    setBusy(true);
    setFeedback(null);
    let succeeded = 0;
    const failures: string[] = [];
    for (const line of lines) {
      try {
        await jobs.enqueue({ kind: 'link', targetRef: line });
        succeeded += 1;
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (succeeded > 0) {
      setText('');
    }
    setBusy(false);
    setFeedback({
      kind: failures.length === 0 ? 'ok' : 'error',
      text:
        failures.length === 0
          ? `已入队 ${succeeded} 条，稍候在「资料库」查看结果。`
          : `${succeeded} 入队成功 / ${failures.length} 失败：${failures
              .slice(0, 2)
              .join('；')}${failures.length > 2 ? '…' : ''}`,
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold tracking-tight">粘贴链接立即采集</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        支持 www.douyin.com/video/... 或 v.douyin.com 短链；一行一个。
        当前博主全量 / 关键词搜索受抖音反爬限制（见下方两节），
        <strong className="font-semibold text-foreground/90">手动粘链接是最稳的入库路径</strong>。
      </p>
      <Textarea
        rows={4}
        className="mt-3 font-mono text-xs"
        placeholder={
          'https://www.douyin.com/video/7634036956485143846\nhttps://v.douyin.com/abcd1234/\n...'
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {lines.length > 0 ? `准备入队 ${lines.length} 条` : '一行一个抖音链接'}
        </span>
        <Button onClick={onCollect} disabled={busy || lines.length === 0}>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          采集 {lines.length > 0 ? `（${lines.length}）` : ''}
        </Button>
      </div>
      {feedback ? (
        <p
          className={
            feedback.kind === 'ok'
              ? 'mt-2 text-xs text-emerald-600 dark:text-emerald-400'
              : 'mt-2 text-xs text-rose-500'
          }
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}
