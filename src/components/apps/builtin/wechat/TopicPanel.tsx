'use client';

import * as React from 'react';
import { Loader2, MessageSquareText, Sparkles, Settings as SettingsIcon, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import type { MessageContextResult, TopicEntry, TopicScope, TopicSourceSummary } from '@/lib/wechat-assistant/mirror-store';
import { displayWechatName, safeSanitizedWechatText } from './display-helpers';
import type { TopicProgress, TopicSummaryView } from './use-wechat-topics';

export function TopicPanel({
  scope,
  summary,
  progress,
  whitelistCount,
  hasProvider,
  onRun,
  onConfigure,
}: {
  scope: TopicScope;
  summary: TopicSummaryView | null;
  progress: TopicProgress | null;
  whitelistCount: number;
  hasProvider: boolean;
  onRun: () => void;
  onConfigure: () => void;
}): React.ReactElement {
  const running = !!summary?.inFlight || progress?.phase === 'running' || progress?.phase === 'starting';
  const hasResults = summary && summary.sources.some((source) => source.topics.length > 0);
  const accent = scope === 'personal' ? 'sky' : 'amber';
  const title = scope === 'personal' ? '私聊话题' : '群聊话题';

  return (
    <Card className={cn('ring-1', accent === 'sky' ? 'ring-sky-500/15' : 'ring-amber-500/15')}>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {summary
                ? `${summary.dateFrom} 至 ${summary.dateTo}`
                : '每天 04:00 自动归档上一天'}
            </p>
          </div>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px]',
            accent === 'sky' ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}>
            {whitelistCount} 个来源
          </span>
        </div>
        <Body
          scope={scope}
          accent={accent}
          summary={summary}
          progress={progress}
          whitelistCount={whitelistCount}
          hasProvider={hasProvider}
          running={running}
          hasResults={!!hasResults}
          onRun={onRun}
          onConfigure={onConfigure}
        />
      </CardContent>
    </Card>
  );
}

function Body(props: {
  scope: TopicScope;
  accent: 'sky' | 'amber';
  summary: TopicSummaryView | null;
  progress: TopicProgress | null;
  whitelistCount: number;
  hasProvider: boolean;
  running: boolean;
  hasResults: boolean;
  onRun: () => void;
  onConfigure: () => void;
}) {
  const { scope, accent, summary, progress, whitelistCount, hasProvider, running, hasResults, onRun, onConfigure } = props;

  if (whitelistCount === 0) {
    return (
      <EmptyState
        title={scope === 'personal' ? '尚未选择要分析的私聊' : '尚未选择要分析的群聊'}
        description="为了保护隐私，AI 只会读取你明确选择的对话。先去设置里选择白名单。"
        cta="去设置 · 近期话题"
        onCta={onConfigure}
        icon={<SettingsIcon className="size-4" />}
      />
    );
  }

  if (!hasProvider) {
    return (
      <EmptyState
        title="尚未配置 AI 服务商"
        description="近期话题需要调用大模型。先到设置里选一个支持文本生成的服务商。"
        cta="去配置 · AI 服务商"
        onCta={onConfigure}
        icon={<SettingsIcon className="size-4" />}
      />
    );
  }

  if (running) {
    return (
      <RunningState message={progress?.message ?? '分析中…'} progress={progress} accent={accent} />
    );
  }

  if (progress?.phase === 'error') {
    return (
      <ErrorState message={progress.message} onRetry={onRun} />
    );
  }

  if (!hasResults) {
    if (summary?.state === 'failed') {
      return (
        <ErrorState message={summary.error ?? '近期话题生成失败，请稍后重试。'} onRetry={onRun} />
      );
    }
    if (summary?.state === 'running') {
      return (
        <EmptyState
          title="上次分析未完成"
          description="上次话题分析可能在应用退出或服务重启时中断。可以重新生成当前日期范围的最后一天。"
          cta="生成所选结束日"
          onCta={onRun}
          icon={<RefreshCw className="size-4" />}
        />
      );
    }
    if (progress?.phase === 'skipped') {
      const skipped = skippedState(progress.reason);
      return (
        <EmptyState
          title={skipped.title}
          description={skipped.description}
          cta={skipped.cta}
          onCta={skipped.configure ? onConfigure : onRun}
          icon={skipped.configure ? <SettingsIcon className="size-4" /> : <Sparkles className="size-4" />}
        />
      );
    }
    const archivedEmpty = summary?.state === 'done';
    return (
      <EmptyState
        title={archivedEmpty ? '当前日期范围暂无话题' : '尚未生成'}
        description={
          archivedEmpty
            ? '该日期范围内没有足够可分析的文本消息，或白名单会话当天没有产生可归纳的话题。'
            : `已选择 ${whitelistCount} 个对话进入分析。系统会每天 04:00 后自动归档上一天；当前范围用于查看，手动生成会处理所选范围的最后一天。`
        }
        cta="生成所选结束日"
        onCta={onRun}
        icon={<Sparkles className="size-4" />}
      />
    );
  }

  return (
    <ResultsState
      summary={summary!}
      onRun={onRun}
      onConfigure={onConfigure}
      accent={accent}
    />
  );
}

function EmptyState({
  title,
  description,
  cta,
  onCta,
  icon,
}: {
  title: string;
  description: string;
  cta: string;
  onCta: () => void;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      <Button variant="outline" size="sm" onClick={onCta} className="gap-1.5">
        {icon}
        {cta}
      </Button>
    </div>
  );
}

function RunningState({
  message,
  progress,
  accent,
}: {
  message: string;
  progress: TopicProgress | null;
  accent: 'sky' | 'amber';
}) {
  const pct = progress && progress.batchTotal > 0
    ? Math.min(100, Math.round((progress.batchIndex / progress.batchTotal) * 100))
    : null;
  return (
    <div className="flex min-h-[140px] flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className={cn('size-4 animate-spin', accent === 'sky' ? 'text-sky-600' : 'text-amber-600')} />
        <span className="font-medium">{message}</span>
      </div>
      {pct !== null ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full transition-all', accent === 'sky' ? 'bg-sky-500' : 'bg-amber-500')}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
      ) : null}
      {progress && progress.topicsCollected > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          已收集 {progress.topicsCollected} 个候选话题
        </p>
      ) : null}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[140px] flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm font-medium text-rose-600">生成失败</p>
      <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

function ResultsState({
  summary,
  onRun,
  onConfigure,
  accent,
}: {
  summary: TopicSummaryView;
  onRun: () => void;
  onConfigure: () => void;
  accent: 'sky' | 'amber';
}) {
  const [contextTarget, setContextTarget] = React.useState<{
    source: TopicSourceSummary;
    topic: TopicEntry;
  } | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {summary.state === 'failed' ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
          这个日期范围里有部分话题分析失败：{summary.error ?? '可重新生成所选结束日。'}
        </div>
      ) : null}
      <div className="flex flex-col gap-4">
        {summary.sources.filter((source) => source.topics.length > 0).map((source) => (
          <SourceGroup
            key={source.wxid}
            source={source}
            accent={accent}
            onOpenContext={(topic) => setContextTarget({ source, topic })}
          />
        ))}
      </div>
      <div className="flex items-center justify-between border-t pt-3 text-[11px] text-muted-foreground">
        <span>
          {summary.dateFrom} 至 {summary.dateTo} · {summary.chatCount} 个来源 · {summary.messageCount.toLocaleString('zh-CN')} 条消息 ·{' '}
          <RelativeTime ts={summary.generatedAt} />
        </span>
        <span className="flex items-center gap-2">
          <button onClick={onConfigure} className="hover:text-foreground transition-colors">
            白名单设置
          </button>
          <span>·</span>
          <button onClick={onRun} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
            <RefreshCw className="size-3" />
            生成所选结束日
          </button>
        </span>
      </div>
      <TopicContextDialog
        target={contextTarget}
        dateFrom={summary.dateFrom}
        dateTo={summary.dateTo}
        onOpenChange={(open) => {
          if (!open) setContextTarget(null);
        }}
      />
    </div>
  );
}

function skippedState(reason: TopicProgress['reason']): {
  title: string;
  description: string;
  cta: string;
  configure: boolean;
} {
  switch (reason) {
    case 'whitelist_empty':
      return {
        title: '没有可分析的白名单对话',
        description: '当前白名单为空，或已被排除名单过滤掉。为了保护隐私，近期话题只分析明确允许的对话。',
        cta: '去设置 · 近期话题',
        configure: true,
      };
    case 'no_provider':
      return {
        title: '尚未配置 AI 服务商',
        description: '近期话题需要调用大模型。先到设置里选一个支持文本生成的服务商。',
        cta: '去配置 · AI 服务商',
        configure: true,
      };
    case 'no_model':
      return {
        title: '当前服务商没有可用模型',
        description: '这个服务商没有解析出可用文本模型。请在服务商设置里补全模型，或切换到其它文本服务商。',
        cta: '去配置 · AI 服务商',
        configure: true,
      };
    case 'in_progress':
      return {
        title: '已有话题分析在运行',
        description: '后台仍在处理同一类话题，稍等片刻后页面会自动刷新结果。',
        cta: '刷新状态',
        configure: false,
      };
    case 'no_messages':
    default:
      if (reason === 'sync_unavailable') {
        return {
          title: '微信消息尚未同步成功',
          description: '生成近期话题前需要先读取本机微信消息。请先完成数据授权、密钥恢复并同步消息。',
          cta: '生成所选结束日',
          configure: false,
        };
      }
      return {
        title: '当前日期没有足够消息',
        description: '该日期内白名单对话没有达到最低消息数，或没有可分析的文本消息。',
        cta: '生成所选结束日',
        configure: false,
      };
  }
}

function SourceGroup({
  source,
  accent,
  onOpenContext,
}: {
  source: TopicSourceSummary;
  accent: 'sky' | 'amber';
  onOpenContext: (topic: TopicEntry) => void;
}) {
  const sourceName = displayWechatName(source.display, source.wxid, {
    groupFallback: '微信群聊',
    contactFallback: '微信联系人',
  });
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{sourceName}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {source.isGroup ? '群聊' : '私聊'} · {source.messageCount.toLocaleString('zh-CN')} 条消息 · {source.days.length} 天
          </p>
        </div>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px]',
          accent === 'sky' ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        )}>
          {source.topics.length} 个话题
        </span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        {source.topics.map((topic, idx) => (
          <TopicRow
            key={`${source.wxid}-${topic.title}-${idx}`}
            topic={topic}
            accent={accent}
            onOpenContext={() => onOpenContext(topic)}
          />
        ))}
      </div>
    </div>
  );
}

function TopicRow({
  topic,
  accent,
  onOpenContext,
}: {
  topic: TopicEntry;
  accent: 'sky' | 'amber';
  onOpenContext: () => void;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
      <span
        className={cn(
          'mt-2 inline-block size-1.5 shrink-0 rounded-full',
          accent === 'sky' ? 'bg-sky-500' : 'bg-amber-500',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{topic.title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{topic.summary}</p>
        {topic.participants.length > 0 ? (
          <p className="mt-1 truncate text-[10px] text-muted-foreground/80">
            {topic.participants.slice(0, 5).join(' · ')}
            {topic.participants.length > 5 ? ` +${topic.participants.length - 5}` : ''}
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          'flex shrink-0 flex-col items-end gap-1 text-[11px] tabular-nums',
          accent === 'sky' ? 'text-sky-700 dark:text-sky-400' : 'text-amber-700 dark:text-amber-400',
        )}
      >
        <span>{topic.messageCount} 条</span>
        <button
          type="button"
          onClick={onOpenContext}
          className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MessageSquareText className="size-3" />
          消息
        </button>
      </div>
    </div>
  );
}

function TopicContextDialog({
  target,
  dateFrom,
  dateTo,
  onOpenChange,
}: {
  target: { source: TopicSourceSummary; topic: TopicEntry } | null;
  dateFrom: string;
  dateTo: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [context, setContext] = React.useState<MessageContextResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!target) {
      setContext(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      wxid: target.source.wxid,
      title: target.topic.title,
      summary: target.topic.summary,
      from: dateFrom,
      to: dateTo,
    });
    void fetch(`/api/apps/builtin/wechat/topics/context?${params.toString()}`, {
      cache: 'no-store',
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          context?: unknown;
          error?: string;
          message?: string;
        };
        if (!res.ok || !isMessageContextResult(json.context)) {
          throw new Error(json.message ?? json.error ?? '消息上下文加载失败');
        }
        setContext(json.context);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : '消息上下文加载失败');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [dateFrom, dateTo, target]);

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="!flex h-[85vh] max-h-[calc(100vh-2rem)] w-[min(720px,calc(100vw-2rem))] flex-col overflow-hidden sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-base">{target?.topic.title ?? '相关消息'}</DialogTitle>
          <DialogDescription>
            {target
              ? `${displayWechatName(target.source.display, target.source.wxid, {
                groupFallback: '微信群聊',
                contactFallback: '微信联系人',
              })} · ${dateFrom} 至 ${dateTo}`
              : '相关消息上下文'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-3">
          {loading ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载消息中…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-4 text-center text-xs text-destructive">
              {error}
            </div>
          ) : context ? (
            <div className="flex flex-col gap-2">
              {context.messages.map((message, idx) => (
                <div
                  key={`${message.ts}-${idx}`}
                  className={cn(
                    'rounded-lg border bg-background px-3 py-2 text-xs leading-5',
                    Math.abs(message.ts - context.targetTs) < 2 && 'border-primary/40 bg-primary/5',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>{contextSpeakerLabel(message, context.isGroup)}</span>
                    <span>{formatMessageTime(message.ts)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">
                    {safeSanitizedWechatText(message.content, '消息内容已隐藏')}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function contextSpeakerLabel(
  message: MessageContextResult['messages'][number],
  isGroup: boolean,
): string {
  if (message.sender === 'me') return '我';
  if (isGroup && message.senderDisplay) {
    return displayWechatName(message.senderDisplay, null, { contactFallback: '群成员' });
  }
  return isGroup ? '群成员' : '对方';
}

function RelativeTime({ ts }: { ts: number }) {
  const [label, setLabel] = React.useState(() => formatRel(ts, Date.now()));
  React.useEffect(() => {
    const tick = () => setLabel(formatRel(ts, Date.now()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [ts]);
  return <span>{label}</span>;
}

function formatRel(ts: number, now: number): string {
  if (!ts) return '从未生成';
  const diff = now - ts;
  if (diff < 60_000) return '刚刚生成';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前生成`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前生成`;
  return `${Math.round(diff / 86_400_000)} 天前生成`;
}

function formatMessageTime(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isMessageContextResult(value: unknown): value is MessageContextResult {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<MessageContextResult>;
  return (
    typeof context.wxid === 'string'
    && typeof context.display === 'string'
    && typeof context.isGroup === 'boolean'
    && typeof context.targetTs === 'number'
    && Array.isArray(context.messages)
    && context.messages.every(isContextMessage)
  );
}

function isContextMessage(value: unknown): value is MessageContextResult['messages'][number] {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<MessageContextResult['messages'][number]>;
  return (
    typeof message.ts === 'number'
    && (message.sender === 'me' || message.sender === 'them')
    && (message.senderDisplay === null || typeof message.senderDisplay === 'string')
    && typeof message.content === 'string'
  );
}
