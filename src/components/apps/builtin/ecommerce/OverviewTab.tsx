'use client';

import * as React from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Compass,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Package,
  Rocket,
  Sparkles,
  Wand2,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

import type {
  DashboardSnapshot,
  DashboardTodo,
  EcommerceTab,
  OnboardingState,
  OnboardingStep,
  PipelineEntry,
} from './types';

interface OverviewTabProps {
  snapshot: DashboardSnapshot | null;
  pipelineCount: number;
  loading: boolean;
  onJump: (target: EcommerceTab) => void;
}

export function OverviewTab({
  snapshot,
  loading,
  onJump,
}: OverviewTabProps): React.ReactElement {
  if (loading && !snapshot) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> 加载中…
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        暂无数据。先去「选品」开始第一次研究，或在「工坊」记录商品输入。
      </div>
    );
  }

  const c = snapshot.counts;

  return (
    <div className="flex flex-col gap-6">
      {/* Onboarding（仅未完成时显示） */}
      {!snapshot.onboarding.complete ? (
        <OnboardingCard onboarding={snapshot.onboarding} onJump={onJump} />
      ) : null}

      {/* KPI 行 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={Compass}
          title="选品候选"
          mainValue={c.candidates.total}
          breakdown={[
            { label: 'ready', value: c.candidates.ready },
            { label: 'promoted', value: c.candidates.promoted, tone: 'positive' },
            { label: 'failed', value: c.candidates.failed, tone: 'negative' },
          ]}
          onClick={() => onJump('discover')}
        />
        <KpiCard
          icon={Package}
          title="产品"
          mainValue={c.products.total}
          breakdown={[
            { label: '缺主图', value: c.products.needsMain, tone: c.products.needsMain > 0 ? 'warning' : 'neutral' },
            { label: '有终版图', value: c.products.hasFinal, tone: 'positive' },
          ]}
          onClick={() => onJump('studio')}
        />
        <KpiCard
          icon={Wand2}
          title="出图任务"
          mainValue={c.jobs.total}
          breakdown={[
            { label: '运行中', value: c.jobs.running, tone: c.jobs.running > 0 ? 'positive' : 'neutral' },
            { label: '完成', value: c.jobs.completed },
            { label: '失败', value: c.jobs.failed, tone: 'negative' },
          ]}
          onClick={() => onJump('jobs')}
        />
        <KpiCard
          icon={FileText}
          title="Listing"
          mainValue={c.listings.total}
          breakdown={[
            { label: 'live', value: c.listings.live, tone: 'positive' },
            { label: 'submitted', value: c.listings.submitted },
            { label: 'rejected', value: c.listings.rejected, tone: 'negative' },
          ]}
          onClick={() => onJump('listings')}
        />
      </div>

      {/* 待办 + 快速入口 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">待办建议</CardTitle>
            </CardHeader>
            <CardContent>
              {snapshot.todos.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  没有待办。一切就绪 ✓
                </p>
              ) : (
                <ul className="space-y-2">
                  {snapshot.todos.map((t) => (
                    <TodoItem key={t.id} todo={t} onJump={onJump} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">快速入口</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button variant="outline" className="justify-start" onClick={() => onJump('discover')}>
              <Sparkles className="size-4" /> 新选品研究
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => onJump('studio')}>
              <Package className="size-4" /> 录入新产品
            </Button>
            <Button variant="outline" className="justify-start" onClick={() => onJump('listings')}>
              <FileText className="size-4" /> 起 listing 草稿
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 最近 final 图 + 已上线 listing */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近终版图</CardTitle>
          </CardHeader>
          <CardContent>
            {snapshot.recentFinalImages.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                还没有终版图。上传商品主图后启动出图 SOP。
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {snapshot.recentFinalImages.slice(0, 8).map((w) => (
                  <div key={w.imagePath} className="overflow-hidden rounded-md border">
                    <ImagePreview path={w.imagePath} alt={w.productTitle} />
                    <p className="truncate p-1.5 text-[10px] text-muted-foreground">
                      {w.productTitle}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="size-4 text-emerald-600" /> 已上线 listing
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapshot.liveListings.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                还没有上线的 listing。复制草稿到平台后在 Listings Tab 点「已上线」。
              </p>
            ) : (
              <ul className="space-y-2">
                {snapshot.liveListings.map((l) => (
                  <li key={l.draftId} className="rounded-md border p-2">
                    <p className="truncate text-xs font-medium">{l.productTitle}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {l.platform}
                      {l.liveAt ? ` · ${formatDate(l.liveAt)}` : ''}
                    </p>
                    {l.liveUrl ? (
                      <a
                        href={l.liveUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:underline dark:text-emerald-400"
                      >
                        <ExternalLink className="size-2.5" />
                        {shortUrl(l.liveUrl)}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 活动时间线 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">最近活动</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshot.recentActivity.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">还没有活动。</p>
          ) : (
            <ol className="space-y-1 text-xs">
              {snapshot.recentActivity.map((a) => (
                <li
                  key={`${a.kind}-${a.id}`}
                  className="flex items-baseline gap-2 border-b py-1.5 last:border-0"
                >
                  <span className="w-16 shrink-0 text-[10px] text-muted-foreground">
                    {formatRelative(a.at)}
                  </span>
                  <span className="w-12 shrink-0 rounded-md bg-foreground/5 px-1.5 py-0.5 text-center text-[10px]">
                    {kindLabel(a.kind)}
                  </span>
                  <span className="flex-1 truncate">{a.title}</span>
                  <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">
                    {a.detail}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-[10px] text-muted-foreground">
        快照时间：{formatDate(snapshot.generatedAt)}
      </p>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  title,
  mainValue,
  breakdown,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  mainValue: number;
  breakdown: { label: string; value: number; tone?: 'neutral' | 'positive' | 'negative' | 'warning' }[];
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-foreground/5"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="size-3.5" /> {title}
        </span>
        <ArrowRight className="size-3 text-muted-foreground" />
      </div>
      <p className="text-2xl font-semibold tabular-nums">{mainValue}</p>
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        {breakdown.map((b, i) => (
          <span
            key={i}
            className={`rounded-md px-1.5 py-0.5 tabular-nums ring-1 ${
              b.tone === 'positive'
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900'
                : b.tone === 'negative'
                ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900'
                : b.tone === 'warning'
                ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900'
                : 'bg-foreground/5 text-foreground ring-border'
            }`}
          >
            {b.label} {b.value}
          </span>
        ))}
      </div>
    </button>
  );
}

function TodoItem({
  todo,
  onJump,
}: {
  todo: DashboardTodo;
  onJump: (t: EcommerceTab) => void;
}): React.ReactElement {
  const tone =
    todo.priority === 'high'
      ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-300 dark:ring-red-900'
      : todo.priority === 'medium'
      ? 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900'
      : 'bg-foreground/5 text-foreground ring-border';
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border p-2.5">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ring-1 ${tone}`}>
          {todo.priority}
        </span>
        <span className="text-xs">{todo.text}</span>
      </div>
      <Button size="sm" variant="ghost" onClick={() => onJump(todo.jumpTo)}>
        前往 <ArrowRight className="size-3" />
      </Button>
    </li>
  );
}

function ImagePreview({ path, alt }: { path: string; alt: string }): React.ReactElement {
  // Local file paths: convert to lumos files API. Fall back to icon if path empty.
  if (!path) {
    return (
      <div className="flex aspect-[4/5] items-center justify-center bg-muted">
        <ImageIcon className="size-6 text-muted-foreground" />
      </div>
    );
  }
  const url = `/api/files/raw?path=${encodeURIComponent(path)}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className="aspect-[4/5] w-full object-cover"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'candidate':
      return '选品';
    case 'product':
      return '产品';
    case 'job':
      return '出图';
    case 'listing':
      return '上架';
    default:
      return kind;
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16);
  }
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}时前`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}天前`;
    return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  } catch {
    return iso.slice(5, 10);
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + '…' : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url.slice(0, 50);
  }
}

function OnboardingCard({
  onboarding,
  onJump,
}: {
  onboarding: OnboardingState;
  onJump: (t: EcommerceTab) => void;
}): React.ReactElement {
  const pct = Math.round((onboarding.doneCount / onboarding.totalCount) * 100);
  const next = onboarding.nextStep;
  return (
    <Card className="border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-base">
          <span className="flex items-center gap-2">
            <Rocket className="size-4 text-blue-600" />
            快速上手 — 完成 {onboarding.doneCount}/{onboarding.totalCount} 步
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {pct}%
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-foreground/10">
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="space-y-1.5">
          {onboarding.steps.map((s) => (
            <OnboardingStepRow
              key={s.id}
              step={s}
              isNext={next?.id === s.id}
              onJump={onJump}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function OnboardingStepRow({
  step,
  isNext,
  onJump,
}: {
  step: OnboardingStep;
  isNext: boolean;
  onJump: (t: EcommerceTab) => void;
}): React.ReactElement {
  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${
        isNext ? 'bg-foreground/5 ring-1 ring-blue-300 dark:ring-blue-800' : ''
      }`}
    >
      <div className="flex min-w-0 items-start gap-2">
        {step.done ? (
          <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
        ) : (
          <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <p
            className={`text-xs ${
              step.done ? 'text-muted-foreground line-through' : 'text-foreground'
            }`}
          >
            {step.title}
          </p>
          {!step.done ? (
            <p className="truncate text-[11px] text-muted-foreground">{step.description}</p>
          ) : null}
        </div>
      </div>
      {!step.done ? (
        <Button
          size="sm"
          variant={isNext ? 'default' : 'ghost'}
          onClick={() => onJump(step.jumpTo)}
        >
          前往 <ArrowRight className="size-3" />
        </Button>
      ) : null}
    </li>
  );
}

// kept exported type to avoid TS unused-import noise across rebuilds
export type _Unused = PipelineEntry;
