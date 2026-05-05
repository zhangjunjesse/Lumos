'use client';

import * as React from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import {
  ActiveConversations,
  HighlightList,
  KeywordCloud,
  TodoList,
} from './OverviewLists';
import type { Analysis } from './wechat-types';

export function OverviewTab({
  ready,
  analysis,
  loading,
  error,
  onRefresh,
}: {
  ready: boolean;
  analysis: Analysis | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}): React.ReactElement {
  if (!ready) {
    return <NotReadyHint />;
  }
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={onRefresh} disabled={loading} variant="outline" size="sm" className="w-fit">
          <RefreshCw className={cn(loading && 'animate-spin')} />
          重试
        </Button>
      </div>
    );
  }
  if (!analysis) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
          {loading ? <Loader2 className="size-6 animate-spin text-muted-foreground" /> : null}
          <p className="text-sm text-muted-foreground">
            {loading ? '读取中...' : '点击右上角「开始分析」'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const tiles = [
    { label: '重点', value: analysis.highlights.length },
    { label: '待办', value: analysis.todos.length },
    { label: '活跃会话', value: analysis.topConversations.length },
    { label: '关键词', value: analysis.keywordTrends.length },
  ];

  return (
    <div className="flex flex-col gap-8">
      <MetricStrip tiles={tiles} />
      <SummaryParagraph analysis={analysis} loading={loading} />
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <HighlightList highlights={analysis.highlights} />
        <TodoList todos={analysis.todos} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <ActiveConversations items={analysis.topConversations} />
        <KeywordCloud trends={analysis.keywordTrends} />
      </div>
    </div>
  );
}

function NotReadyHint() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm">尚未授权读取微信消息</p>
        <p className="text-xs text-muted-foreground">
          在上方完成授权后会自动开始分析
        </p>
      </CardContent>
    </Card>
  );
}

function MetricStrip({ tiles }: { tiles: Array<{ label: string; value: number }> }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex flex-col gap-1">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {tile.label}
          </p>
          <p className="text-3xl font-semibold tabular-nums tracking-tight">
            {tile.value.toLocaleString('zh-CN')}
          </p>
        </div>
      ))}
    </div>
  );
}

function SummaryParagraph({ analysis, loading }: { analysis: Analysis; loading: boolean }) {
  return (
    <div className="flex flex-col gap-2 border-l-2 pl-5">
      <div className="flex items-center gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">总览</p>
        {loading ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            更新中
          </span>
        ) : null}
      </div>
      <p className="text-base leading-7">{analysis.summary}</p>
      {analysis.source.messagesTruncated ? (
        <p className="text-[11px] text-muted-foreground tabular-nums">
          覆盖 {analysis.source.totalReadableMessages.toLocaleString('zh-CN')} 条 ·
          纳入 {analysis.source.messagesScanned.toLocaleString('zh-CN')} 条 ·
          上限 {analysis.source.safetyLimit}
        </p>
      ) : null}
    </div>
  );
}
