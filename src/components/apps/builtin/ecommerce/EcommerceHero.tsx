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
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-10 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" strokeWidth={1.6} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h1 className="text-base font-semibold tracking-tight">电商商品助手</h1>
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                内置 · 电商
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <PhaseDot phase={status?.phase} loading={loading && !status} />
                {phaseLabel}
                {status?.inventory.runningJobs ? (
                  <span className="tabular-nums">· {status.inventory.runningJobs} 任务进行中</span>
                ) : null}
                {status?.inventory.inputCount ? (
                  <span className="tabular-nums">· {status.inventory.inputCount} 商品输入</span>
                ) : null}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              基于 SOP 流程一键生成电商商品图：参考图筛选 → brief 识别 → 抠图 → 3 个方向 → 评分 → 终版精修 → 质检 → 兜底白底。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="shrink-0 rounded-md border bg-background px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing ? '刷新中…' : '刷新'}
        </button>
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
