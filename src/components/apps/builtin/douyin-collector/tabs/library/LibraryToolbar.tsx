'use client';

import * as React from 'react';
import {
  CheckCircle2,
  Loader2,
  RefreshCcw,
  RotateCcw,
  Wand,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { LibraryStatusFilter } from '../../use-videos';
import { ExportMenu } from './ExportMenu';

export type BulkBusy = 'idle' | 'transcribe' | 'retry' | 'publish';

/**
 * Library top-of-page action toolbar.
 *
 * Pure presentation: parent owns bulk-mutation state and runs the actual
 * `runBulk` dispatch. We just wire button onClick → callback.
 * This keeps business-logic branches (filter awareness, eligible-set
 * gating) in the parent where they belong.
 *
 * Extracted from LibraryTab in round 8.
 */
export function LibraryToolbar({
  bulkBusy,
  eligiblePublishCount,
  filterActive,
  visibleIds,
  status,
  loading,
  onBulkTranscribe,
  onBulkRetry,
  onBulkPublish,
  onRefresh,
}: {
  bulkBusy: BulkBusy;
  eligiblePublishCount: number;
  filterActive: boolean;
  visibleIds: string[];
  status: LibraryStatusFilter;
  loading: boolean;
  onBulkTranscribe: () => void;
  onBulkRetry: () => void;
  onBulkPublish: () => void;
  onRefresh: () => void;
}): React.ReactElement {
  const idle = bulkBusy === 'idle';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={!idle} onClick={onBulkTranscribe}>
        {bulkBusy === 'transcribe' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Wand className="size-3.5" />
        )}
        批量抓字幕
      </Button>
      <Button size="sm" variant="outline" disabled={!idle} onClick={onBulkRetry}>
        {bulkBusy === 'retry' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RotateCcw className="size-3.5" />
        )}
        重跑失败
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!idle}
        title={
          filterActive
            ? `仅处理当前筛选可见且有字幕、未入当前知识库、需补索引或需补概述/要点的视频（${eligiblePublishCount} 条）`
            : '入库或补资料库前 30 条草稿/待整理/索引异常/概述缺失内容（每条对应一篇知识库 item）'
        }
        onClick={onBulkPublish}
      >
        {bulkBusy === 'publish' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="size-3.5" />
        )}
        批量入库/补资料库{filterActive ? `（${eligiblePublishCount}）` : ''}
      </Button>
      <ExportMenu status={status} filterActive={filterActive} visibleIds={visibleIds} />
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
        <RefreshCcw className="size-3.5" />
        刷新
      </Button>
    </div>
  );
}
