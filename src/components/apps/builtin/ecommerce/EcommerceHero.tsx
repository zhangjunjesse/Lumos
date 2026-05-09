'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';

import type { EcommerceAssistantStatus } from './types';

export function EcommerceHero({
  status,
  loading,
  refreshing,
  onRefresh,
}: {
  status: EcommerceAssistantStatus | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  const phaseLabel = describePhase(status);
  return (
    <div className="border-b bg-card">
      <div className="mx-auto flex max-w-6xl items-start justify-between gap-6 px-10 py-8">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-6" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              内置 · 电商
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">电商商品助手</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              基于 SOP 流程一键生成电商商品图：参考图筛选 → brief 识别 → 抠图 → 3 个方向 → 评分 → 终版精修 → 质检 → 兜底白底。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <PhaseDot phase={status?.phase} loading={loading && !status} />
              <span className="text-muted-foreground">{phaseLabel}</span>
              {status?.inventory.runningJobs ? (
                <span className="text-muted-foreground tabular-nums">
                  · {status.inventory.runningJobs} 个任务进行中
                </span>
              ) : null}
              {status?.inventory.inputCount ? (
                <span className="text-muted-foreground tabular-nums">
                  · {status.inventory.inputCount} 个商品输入
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="rounded-md border bg-background px-3 py-1.5 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PhaseDot({
  phase,
  loading,
}: {
  phase?: string;
  loading: boolean;
}): React.ReactElement {
  if (loading) {
    return <span className="size-2 rounded-full bg-muted-foreground/60" />;
  }
  const tone =
    phase === 'ready'
      ? 'bg-emerald-500'
      : phase === 'failed'
        ? 'bg-red-500'
        : 'bg-amber-500';
  return <span className={`size-2 rounded-full ${tone}`} />;
}

function describePhase(status: EcommerceAssistantStatus | null): string {
  if (!status) return '加载中…';
  switch (status.phase) {
    case 'ready':
      return '就绪';
    case 'needs-install':
      return '应用未安装';
    case 'needs-image-provider':
      return `需配置图像服务商：${status.providers.image.reason ?? '未解析'}`;
    case 'needs-analysis-provider':
      return `需配置分析 provider：${status.providers.analysis.reason ?? '未解析'}`;
    case 'failed':
      return status.inventory.storeError ?? '应用数据层失败';
    default:
      return status.phase;
  }
}
