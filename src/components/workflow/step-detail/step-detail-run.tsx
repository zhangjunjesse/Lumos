'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { WorkflowDslStepOverlay } from '../WorkflowDslGraph';
import type { WorkflowNode } from '@/lib/workflow/types-v3';
import { OutputFilePreviewModal, type PreviewableFile } from '../OutputFilePreviewModal';
import { STATUS_CLS, STATUS_LABEL, TYPE_LABEL, fmtDuration, fmtSize, fmtTimeout } from './step-detail-helpers';

interface OutputFileLike {
  name: string;
  stepId: string;
  sizeBytes: number;
  content: string;
  filePath: string;
  mimeType?: string;
}

export function StepDetailHeader({
  node, title, overlay, onClose,
}: {
  node: WorkflowNode;
  title: string;
  overlay?: WorkflowDslStepOverlay;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{TYPE_LABEL[node.type] ?? node.type}</Badge>
          <h3 className="text-base font-semibold truncate">{title}</h3>
          {overlay && (
            <Badge className={`border text-[10px] px-1.5 py-0 ${STATUS_CLS[overlay.status]}`}>
              {STATUS_LABEL[overlay.status]}
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground font-mono">{node.id}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={onClose} className="shrink-0 -mt-1">关闭</Button>
    </div>
  );
}

export function StepRunMetrics({
  overlay, timeoutMs,
}: { overlay: WorkflowDslStepOverlay; timeoutMs?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 rounded-lg bg-muted/30 p-3 text-xs">
      <div>
        <div className="text-muted-foreground">实际耗时</div>
        <div className="font-medium mt-0.5">{fmtDuration(overlay.durationMs)}</div>
      </div>
      <div>
        <div className="text-muted-foreground">产出文件</div>
        <div className="font-medium mt-0.5">{overlay.outputFileCount} 个</div>
      </div>
      <div>
        <div className="text-muted-foreground">超时上限</div>
        <div className="font-medium mt-0.5">{fmtTimeout(timeoutMs)}</div>
      </div>
    </div>
  );
}

export function StepRunError({ error }: { error: string }) {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400 whitespace-pre-wrap break-words">
      <div className="font-medium mb-1">错误信息</div>
      {error}
    </div>
  );
}

export function StepOutputSummary({ summary }: { summary: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs whitespace-pre-wrap break-words">
      <div className="text-muted-foreground font-medium mb-1">输出摘要</div>
      <div className="max-h-40 overflow-y-auto">{summary}</div>
    </div>
  );
}

/**
 * Full per-step context snapshot — everything the engine handed to the agent
 * right before it started running. Collapsed by default so it does not dwarf
 * the step summary; expand to inspect resolved input, runtime, agent binding,
 * and the full StageWorker payload as JSON.
 */
export function StepInputSnapshotSection({ snapshot }: { snapshot: unknown }) {
  const [expanded, setExpanded] = useState(false);
  if (!snapshot || typeof snapshot !== 'object') return null;
  const text = JSON.stringify(snapshot, null, 2);
  const kb = Math.max(1, Math.round(text.length / 1024));
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setExpanded(x => !x)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="inline-block w-3">{expanded ? '▼' : '▶'}</span>
        <span>完整输入上下文（本步实际收到的 resolved input / runtime / code 或 agent 上下文 · {kb}KB）</span>
      </button>
      {expanded && (
        <pre className="max-h-[520px] overflow-auto text-[11px] leading-[1.55] bg-muted/30 rounded-lg p-3 font-mono whitespace-pre-wrap break-all border border-border/40">
          {text}
        </pre>
      )}
    </div>
  );
}

export function StepOutputFiles({ files }: { files: OutputFileLike[] }) {
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);
  if (files.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">本步产出 ({files.length})</div>
      <div className="flex flex-wrap gap-1.5">
        {files.map(f => (
          <button
            key={f.name}
            type="button"
            onClick={() => setPreviewFile({
              name: f.name,
              content: f.content,
              sizeBytes: f.sizeBytes,
              filePath: f.filePath,
              mimeType: f.mimeType,
            })}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] hover:border-primary/50 hover:bg-muted/40 transition-colors cursor-pointer"
            title="点击预览"
          >
            <span className="truncate max-w-[200px]">{f.name}</span>
            <span className="text-muted-foreground font-mono">{fmtSize(f.sizeBytes)}</span>
          </button>
        ))}
      </div>
      <OutputFilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}

export type { OutputFileLike };
