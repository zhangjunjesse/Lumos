'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { AutomationListPane } from './AutomationListPane';
import type { AutomationDraft } from './AutomationFormDialog';
import { ReportsPane } from './ReportsPane';
import type { Automation, Followup } from './relations-types';

/**
 * 自动化模块外壳：横幅 + 子标签（任务 / 运行记录）。
 * 旧版把新建占位、内置推广卡、任务列表、运行结果正文全平铺在一个 1328 行
 * 文件里——已按关注点拆成 List / Form / Reports 三块，shell 只做编排。
 */
export function AutomationsTab({
  automations,
  followups,
  loading,
  saving,
  canRetrySave,
  triggeringId,
  triggerMessage,
  error,
  onRefresh,
  onRetrySave,
  onUpdate,
  onDelete,
  onCreate,
  onTrigger,
}: {
  automations: Automation[];
  followups: Followup[];
  loading: boolean;
  saving: boolean;
  canRetrySave: boolean;
  triggeringId: string | null;
  triggerMessage: string | null;
  error: string | null;
  onRefresh: () => Promise<void> | void;
  onRetrySave: () => Promise<boolean> | void;
  onUpdate: (id: string, patch: Partial<Automation>) => void;
  onDelete: (id: string) => void;
  onCreate: (draft: AutomationDraft) => Promise<Automation | null> | void;
  onTrigger: (id: string) => void;
}): React.ReactElement {
  const triggeringName = triggeringId
    ? automations.find((a) => a.id === triggeringId)?.name ?? '自动化'
    : null;

  return (
    <div className="flex flex-col gap-4">
      <SaveBanner saving={saving} canRetrySave={canRetrySave} error={error} onRetry={onRetrySave} />

      {error && !canRetrySave ? (
        <Banner tone="error">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </Banner>
      ) : null}

      {triggerMessage ? (
        <Banner tone="success">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <span>{triggerMessage}</span>
        </Banner>
      ) : null}

      {triggeringName ? (
        <Banner tone="info">
          <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
          <span>正在触发「{triggeringName}」，请到运行记录里查看结果。</span>
        </Banner>
      ) : null}

      <Tabs defaultValue="tasks" className="flex flex-col gap-4">
        <TabsList className="w-full justify-start gap-1 bg-transparent p-0">
          <SubTab value="tasks" label="任务" badge={automations.filter((a) => a.enabled).length} />
          <SubTab value="runs" label="运行记录" />
        </TabsList>

        {/* forceMount：子 tab 切换不卸载，保住 ReportsPane 的搜索/筛选/分页/选中态，
            也避免每次切回全量重拉。Radix 对非激活内容自动加 hidden。 */}
        <TabsContent value="tasks" forceMount className="m-0 data-[state=inactive]:hidden">
          <AutomationListPane
            automations={automations}
            followups={followups}
            loading={loading}
            saving={saving}
            triggeringId={triggeringId}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onCreate={onCreate}
            onTrigger={onTrigger}
          />
        </TabsContent>

        <TabsContent value="runs" forceMount className="m-0 data-[state=inactive]:hidden">
          <ReportsPane triggerMessage={triggerMessage} onAutomationsRefresh={onRefresh} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SubTab({
  value,
  label,
  badge,
}: {
  value: string;
  label: string;
  badge?: number;
}) {
  return (
    <TabsTrigger
      value={value}
      className="rounded-md border border-transparent px-3 py-1.5 text-xs data-[state=active]:border-border data-[state=active]:bg-muted/40"
    >
      {label}
      {badge ? (
        <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] tabular-nums">{badge}</span>
      ) : null}
    </TabsTrigger>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  children: React.ReactNode;
}) {
  const cls = {
    error: 'border-destructive/30 bg-destructive/5 text-destructive',
    success: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
    info: 'border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300',
  }[tone];
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs', cls)}>
      {children}
    </div>
  );
}

function SaveBanner({
  saving,
  canRetrySave,
  error,
  onRetry,
}: {
  saving: boolean;
  canRetrySave: boolean;
  error: string | null;
  onRetry: () => Promise<boolean> | void;
}) {
  if (!saving && !canRetrySave) return null;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs',
        canRetrySave
          ? 'border border-destructive/30 bg-destructive/5 text-destructive'
          : 'border border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {canRetrySave ? (
          <AlertCircle className="size-3.5 shrink-0" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        )}
        <span className="min-w-0 break-words">
          {canRetrySave ? `保存失败：${error ?? '请重试保存。'}` : '保存中'}
        </span>
      </span>
      {canRetrySave ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void onRetry()}
          className="h-7 shrink-0 px-2 text-xs text-current hover:bg-current/10 hover:text-current"
        >
          <RefreshCw className="size-3.5" />
          重试保存
        </Button>
      ) : null}
    </div>
  );
}
