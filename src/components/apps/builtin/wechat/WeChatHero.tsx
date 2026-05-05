'use client';

import * as React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { phaseLabel, type Analysis, type WeChatAssistantStatus } from './wechat-types';

export function WeChatHero({
  status,
  analysis,
  loading,
  onRefresh,
}: {
  status: WeChatAssistantStatus | null;
  analysis: Analysis | null;
  loading: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  const ready = !!status?.export.ready;
  const portrait = analysis?.portrait;
  const showPortrait = !!(ready && analysis && portrait?.generated);
  const peakHour = portrait?.rhythm.peakHour ?? 0;

  return (
    <header className="border-b">
      <div className="flex items-end justify-between gap-6 px-8 pb-7 pt-8">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            微信助手
          </p>
          <div className="mt-3 flex items-baseline gap-3">
            <h1 className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">
              {showPortrait ? portrait.rhythm.label : ready ? '等待首次分析' : '尚未授权'}
            </h1>
            {loading ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {showPortrait && analysis ? (
              <>
                高峰{' '}
                <span className="text-foreground tabular-nums">
                  {String(peakHour).padStart(2, '0')}:00
                </span>
                {' · '}
                <span className="text-foreground tabular-nums">
                  {analysis.source.messagesScanned.toLocaleString('zh-CN')}
                </span>
                {' 条 · 今日 '}
                <span className="text-foreground tabular-nums">
                  {analysis.source.todayMessages.toLocaleString('zh-CN')}
                </span>
              </>
            ) : (
              <span className={cn(
                status?.export.phase === 'unsupported' ? 'text-rose-600' : '',
              )}>
                {ready ? '点击右侧开始分析' : phaseLabel(status?.export.phase)}
              </span>
            )}
          </p>
        </div>
        <Button
          onClick={onRefresh}
          disabled={!ready || loading}
          variant="outline"
          size="sm"
          className="shrink-0"
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {loading ? '分析中' : analysis ? '重新分析' : '开始分析'}
        </Button>
      </div>
    </header>
  );
}
