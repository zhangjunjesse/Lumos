'use client';

import * as React from 'react';
import { Bell, FileText, Newspaper, BarChart3, ArrowUpRight } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { RadarKind } from '../NewTaskDialog';

interface OverviewTabProps {
  status: {
    library: { alerts: number; reports: number; digests: number; stats: number };
    x: { loggedIn: boolean };
  };
  taskCounts: Record<RadarKind, { total: number; running: number; failed: number }>;
  onOpenKind: (kind: RadarKind) => void;
}

const KIND_META: Record<RadarKind, { label: string; icon: React.ElementType; bg: string; description: string; productLabel: string }> = {
  monitor: { label: '监控雷达', icon: Bell, bg: 'bg-amber-500', description: '按关键词或账号扫推，命中规则入告警', productLabel: '告警' },
  topic: { label: '选题挖掘', icon: FileText, bg: 'bg-violet-500', description: '按话题搜 + thread 抽取，AI 出选题报告', productLabel: '报告' },
  digest: { label: '关注摘要', icon: Newspaper, bg: 'bg-sky-500', description: '按 @ 列表拉最新推，AI 出日报 / 周报', productLabel: '简报' },
  stats: { label: '数据拆解', icon: BarChart3, bg: 'bg-emerald-500', description: '按账号或话题算指标，AI 出数据点评', productLabel: '报告' },
};

const KIND_PRODUCT_KEY: Record<RadarKind, keyof OverviewTabProps['status']['library']> = {
  monitor: 'alerts', topic: 'reports', digest: 'digests', stats: 'stats',
};

export function OverviewTab({ status, taskCounts, onOpenKind }: OverviewTabProps): React.ReactElement {
  return (
    <div className="space-y-6">
      {!status.x.loggedIn && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-50/50 dark:bg-amber-950/20 p-4 text-sm">
          <span className="font-medium">X 未登录</span> — 任务跑不动。先到「服务 → X」登录。
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold tracking-tight">4 个模板</h2>
        <p className="text-sm text-muted-foreground mt-1">挑一个开始建任务。每个模板的产物落到自己的栏目，互不干扰。</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(KIND_META) as RadarKind[]).map((kind) => {
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          const counts = taskCounts[kind];
          const productCount = status.library[KIND_PRODUCT_KEY[kind]];
          return (
            <button
              key={kind}
              onClick={() => onOpenKind(kind)}
              className="group text-left rounded-2xl border bg-card p-5 ring-1 ring-transparent transition-all hover:ring-foreground/20 hover:shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${meta.bg} text-white shadow-sm`}>
                  <Icon className="size-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold tracking-tight">{meta.label}</h3>
                    <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{meta.description}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs">
                <Badge variant="secondary">{counts.total} 任务</Badge>
                {counts.running > 0 && <Badge variant="outline" className="text-blue-600">{counts.running} 运行中</Badge>}
                {counts.failed > 0 && <Badge variant="outline" className="text-red-600">{counts.failed} 失败</Badge>}
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {productCount} 条{meta.productLabel}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
