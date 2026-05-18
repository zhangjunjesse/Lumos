'use client';

import * as React from 'react';
import {
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { STATUS_LABEL, isNonTerminal, type RunStatus } from './run-status';

export interface RunRow {
  id: string;
  status: RunStatus;
  stage: string;
  progress: number;
  category_label: string;
  summary: string;
  ehunt_detected: number;
  keyword_count: number;
  listing_count: number;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * 关键词调研主视图。**新建动作与历史列表是两个视觉上独立的区块**：
 * 顶部一张「发起新调研」卡片（标识 + 主操作按钮，一眼即知是"开始"），
 * 下面一张「调研任务」列表卡片（标题带数量，一眼即知是"历史"）。
 * 不再把新建按钮塞进列表标题栏，避免分不清哪块是列表哪块是新建。
 */
export function KeywordRunList({
  runs,
  loadState,
  busyId,
  confirmId,
  onNew,
  onRefresh,
  onOpen,
  onStop,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  runs: RunRow[];
  loadState: 'loading' | 'ready' | 'error';
  busyId: string | null;
  confirmId: string | null;
  onNew: () => void;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onStop: (id: string) => void;
  onAskDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-4">
      {/* —— 区块 1：发起新调研（独立 CTA 卡片，与列表明确分开）—— */}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">类目 &amp; 关键词调研</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              选 Etsy 类目 → EHunt 逐 tag 抓搜索量/竞争度 → 关键词分析报告
            </p>
          </div>
          <Button size="sm" className="shrink-0" onClick={onNew}>
            <Plus className="size-4" />
            <span className="ml-1">新建调研</span>
          </Button>
        </CardContent>
      </Card>

      {/* —— 区块 2：历史任务列表（独立卡片，标题带数量，明确是"列表"）—— */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-sm text-muted-foreground">
            调研任务{runs.length > 0 ? `（${runs.length}）` : ''}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            title="刷新列表"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loadState === 'loading' && runs.length === 0 ? (
            <p className="flex items-center justify-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载中…
            </p>
          ) : loadState === 'error' && runs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm">
              <p className="text-red-500">任务列表加载失败</p>
              <Button variant="ghost" size="sm" onClick={onRefresh}>
                <RefreshCw className="size-3.5" />
                <span className="ml-1">重试</span>
              </Button>
            </div>
          ) : runs.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              还没有调研任务。点上方「新建调研」选类目生成报告。
            </p>
          ) : (
            <ul className="divide-y">
              {runs.map((r) => {
                const live = isNonTerminal(r.status);
                const busy = busyId === r.id;
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-accent/40"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => onOpen(r.id)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {r.category_label || '(未命名)'}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {STATUS_LABEL[r.status]}
                          {r.status === 'running' ? ` · ${r.progress}%` : ''}
                          {r.summary ? ` · ${r.summary}` : ''}
                          {r.error ? ` · ${r.error}` : ''}
                        </span>
                      </span>
                    </button>
                    {live ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        title="停止（保留记录）"
                        onClick={() => onStop(r.id)}
                      >
                        {busy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Square className="size-3.5 fill-current" />
                        )}
                      </Button>
                    ) : null}
                    {confirmId === r.id ? (
                      <span className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500"
                          disabled={busy}
                          onClick={() => onConfirmDelete(r.id)}
                        >
                          确认
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={onCancelDelete}
                        >
                          取消
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        title={live ? '删除（会同时停止运行）' : '删除'}
                        onClick={() => onAskDelete(r.id)}
                      >
                        <Trash2 className="size-3.5 text-red-500" />
                      </Button>
                    )}
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
