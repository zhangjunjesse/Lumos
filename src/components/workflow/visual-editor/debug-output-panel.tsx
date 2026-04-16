'use client';

import type { DebugStepOutput } from '@/lib/workflow/debug-types';
import { formatDuration } from '@/lib/workflow/step-overlay';

interface Props {
  stepId: string;
  output: DebugStepOutput | null;
  loading: boolean;
  stale?: boolean;
  onClose: () => void;
  onDelete: () => void;
}

function renderPayload(value: unknown): string {
  if (value === undefined) return '(无输出)';
  if (value === null) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function DebugOutputPanel({ stepId, output, loading, stale, onClose, onDelete }: Props) {
  return (
    <div className="absolute right-2 top-2 bottom-2 w-[360px] rounded-lg border border-border/70 bg-background shadow-xl flex flex-col text-[11px] z-20">
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <span className="font-semibold text-foreground flex-1 truncate">缓存输出 · {stepId}</span>
        <button
          type="button"
          onClick={onDelete}
          className="text-[10px] text-red-600 dark:text-red-400 hover:underline"
        >
          删除缓存
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-5 h-5 rounded hover:bg-accent text-muted-foreground"
          aria-label="关闭"
        >×</button>
      </div>

      {loading && <div className="p-3 text-muted-foreground">加载中…</div>}

      {!loading && !output && (
        <div className="p-3 text-muted-foreground">无缓存数据</div>
      )}

      {!loading && output && (
        <div className="flex-1 overflow-auto p-3 space-y-2">
          <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
            <div>
              状态:
              <span className={output.status === 'error' ? 'text-red-500 ml-1' : 'text-emerald-600 ml-1'}>
                {output.status === 'error' ? '失败' : '成功'}
              </span>
            </div>
            <div>耗时: {formatDuration(output.durationMs) || '-'}</div>
            <div className="col-span-2 truncate">完成: {output.completedAt}</div>
            <div className="col-span-2 truncate">hash: {output.configHash.slice(0, 12)}…</div>
            {stale && (
              <div className="col-span-2 text-amber-600 dark:text-amber-400">
                ⚠ 配置已修改,缓存可能陈旧
              </div>
            )}
          </div>

          {output.error && (
            <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-red-700 dark:text-red-400 text-[10px] whitespace-pre-wrap">
              {output.error}
            </div>
          )}

          <div>
            <div className="text-[10px] text-muted-foreground mb-1">output</div>
            <pre className="rounded border border-border/40 bg-muted/30 p-2 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {renderPayload(output.output)}
            </pre>
          </div>

          {Object.keys(output.metadata ?? {}).length > 0 && (
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">metadata</div>
              <pre className="rounded border border-border/40 bg-muted/30 p-2 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(output.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
