'use client';

import * as React from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { ChannelGrid, DraftGrid, RelationshipGrid } from './ContentInsightCards';
import { formatDateTime, type Analysis, type AnalysisContentTopic } from './wechat-types';

export function ContentInsightsTab({
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
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          授权后展示话题、关系圈层与可传播素材
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={onRefresh} disabled={loading} className="w-fit">
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
            {loading ? '挖掘中...' : '点击右上角「开始分析」'}
          </p>
        </CardContent>
      </Card>
    );
  }
  const insights = analysis.contentInsights;

  return (
    <div className="flex flex-col gap-4">
      <SummaryBanner generatedAt={analysis.generatedAt} summary={insights.summary} />
      <TopicGrid topics={insights.topics} />
      <RelationshipGrid signals={insights.relationshipSignals} />
      <DraftGrid drafts={insights.drafts} />
      <ChannelGrid suggestions={insights.channelSuggestions} />
    </div>
  );
}

function SummaryBanner({ generatedAt, summary }: { generatedAt: number; summary: string }) {
  return (
    <div className="flex flex-col gap-2 border-l-2 pl-5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">传播素材</p>
      <p className="break-words text-base leading-7">{summary}</p>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {formatDateTime(generatedAt)} · 发布前请脱敏
      </p>
    </div>
  );
}

function TopicGrid({ topics }: { topics: AnalysisContentTopic[] }) {
  if (topics.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-sm text-muted-foreground">
          暂无稳定话题候选
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {topics.map((topic) => <TopicCard key={topic.id} topic={topic} />)}
    </div>
  );
}

function TopicCard({ topic }: { topic: AnalysisContentTopic }) {
  const tier = topic.score >= 80 ? '强' : topic.score >= 60 ? '中' : '观望';
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {topic.format}
            </p>
            <CardTitle className="mt-1 break-words text-base font-semibold tracking-tight">
              {topic.title}
            </CardTitle>
            <CardDescription className="mt-2 break-words">{topic.reason}</CardDescription>
          </div>
          <ScoreBadge score={topic.score} tier={tier} />
        </div>
        <ScoreBar score={topic.score} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{topic.conversationCount} 会话</span>
          {topic.groupCount > 0 ? <span>· {topic.groupCount} 群聊</span> : null}
          <span>· {topic.spreadLabel}</span>
          <span>· {topic.interestLabel}</span>
          {topic.tags.map((tag) => (
            <span key={tag}>· {tag}</span>
          ))}
        </div>
        <p className="break-words text-sm leading-6 text-muted-foreground">{topic.angle}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <InsightBlock title="兴趣点" body={topic.interestReason} />
          <InsightBlock title="传播路径" body={topic.spreadNarrative} />
        </div>
        <details className="group rounded-lg border bg-background/50">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs text-muted-foreground">
            <span>关系来源 / 原始片段</span>
            <span className="text-[10px] group-open:hidden">展开</span>
            <span className="hidden text-[10px] group-open:inline">收起</span>
          </summary>
          <div className="grid gap-2 border-t p-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">关系来源</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {topic.sources.map((source) => (
                  <div key={source.wxid} className="text-xs">
                    <p className="truncate font-medium">{source.display}</p>
                    <p className="text-muted-foreground">
                      {source.isGroup ? '群聊' : '联系人'} · {source.count} 条
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">原始片段</p>
              <div className="mt-2 flex flex-col gap-1.5">
                {topic.examples.map((example, index) => (
                  <p key={`${example.ts}-${index}`} className="break-words text-xs leading-5">
                    {`"${example.text}"`}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function ScoreBadge({ score, tier }: { score: number; tier: string }) {
  return (
    <div className="flex shrink-0 flex-col items-end">
      <span className="text-3xl font-semibold tabular-nums leading-none tracking-tight">
        {score}
      </span>
      <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {tier}
      </span>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-foreground"
        style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
      />
    </div>
  );
}

function InsightBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-1 break-words text-sm leading-6">{body}</p>
    </div>
  );
}
