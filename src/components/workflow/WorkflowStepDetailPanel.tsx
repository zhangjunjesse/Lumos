'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { WorkflowDslStepOverlay } from './WorkflowDslGraph';
import { OutputFilePreviewModal, type PreviewableFile } from './OutputFilePreviewModal';

interface StepLike {
  id: string;
  type: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
  policy?: { timeoutMs?: number; retry?: { maximumAttempts?: number }; continueOnFailure?: boolean };
  when?: unknown;
  metadata?: { label?: string };
}

interface OutputFileLike {
  name: string;
  stepId: string;
  sizeBytes: number;
  content: string;
  filePath: string;
  mimeType?: string;
}

interface Props {
  step: StepLike;
  presetNames: Record<string, string>;
  overlay?: WorkflowDslStepOverlay;
  outputFiles: OutputFileLike[];
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  agent: 'Agent',
  wait: 'Wait',
  'if-else': 'If / Else',
  'for-each': 'For Each',
  while: 'While',
  notification: 'Notification',
  capability: 'Capability',
};

const STATUS_LABEL: Record<WorkflowDslStepOverlay['status'], string> = {
  pending: '待执行',
  running: '运行中',
  success: '成功',
  error: '失败',
  skipped: '跳过',
};

const STATUS_CLS: Record<WorkflowDslStepOverlay['status'], string> = {
  pending: 'bg-slate-500/10 text-slate-700 border-slate-500/20',
  running: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  success: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  error: 'bg-red-500/10 text-red-700 border-red-500/20',
  skipped: 'bg-slate-400/10 text-slate-600 border-slate-400/20',
};

function fmtDuration(ms: number | null): string {
  if (typeof ms !== 'number' || ms <= 0) return '--';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

function fmtTimeout(ms?: number): string {
  if (typeof ms !== 'number' || ms <= 0) return '--';
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} 分钟` : `${Math.round(ms / 1000)} 秒`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function getString(obj: Record<string, unknown> | undefined, key: string): string | null {
  const v = obj?.[key];
  return typeof v === 'string' && v ? v : null;
}

function formatCondition(c: unknown): string {
  if (!c || typeof c !== 'object') return '--';
  return JSON.stringify(c, null, 2);
}

export function WorkflowStepDetailPanel({ step, presetNames, overlay, outputFiles, onClose }: Props) {
  const fileList = useMemo(
    () => outputFiles.filter(f => f.stepId === step.id),
    [outputFiles, step.id],
  );
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  const input = step.input ?? {};
  const presetId = getString(input, 'preset');
  const presetLabel = presetId ? presetNames[presetId] || presetId : null;
  const prompt = getString(input, 'prompt');
  const expectedOutput = getString(input, 'expectedOutput');
  const preferredModel = getString(input, 'model');
  const role = getString(input, 'role');

  // Remove fields already surfaced elsewhere so the "other config" block only shows novel data.
  const SURFACED = new Set(['preset', 'prompt', 'expectedOutput', 'model', 'role', 'condition', 'body', 'then', 'else', 'collection', 'maxIterations', 'mode', 'durationMs']);
  const otherInput = Object.fromEntries(
    Object.entries(input).filter(([k, v]) => !SURFACED.has(k) && v !== undefined && v !== null && v !== ''),
  );
  const hasOtherInput = Object.keys(otherInput).length > 0;

  const waitMs = step.type === 'wait' && typeof input.durationMs === 'number' ? input.durationMs : null;
  const loopMax = step.type === 'while' && typeof input.maxIterations === 'number' ? input.maxIterations : null;
  const loopMode = step.type === 'while' ? getString(input, 'mode') : null;
  const forEachCollection = step.type === 'for-each' ? getString(input, 'collection') : null;

  const isControlFlow = step.type === 'if-else' || step.type === 'while';

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{TYPE_LABEL[step.type] ?? step.type}</Badge>
            <h3 className="text-base font-semibold truncate">{presetLabel || step.metadata?.label || step.id}</h3>
            {overlay && (
              <Badge className={`border text-[10px] px-1.5 py-0 ${STATUS_CLS[overlay.status]}`}>
                {STATUS_LABEL[overlay.status]}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-mono">{step.id}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="shrink-0 -mt-1">关闭</Button>
      </div>

      {/* Run metrics (only when run data exists) */}
      {overlay && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg bg-muted/30 p-3 text-xs">
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
            <div className="font-medium mt-0.5">{fmtTimeout(step.policy?.timeoutMs)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">依赖</div>
            <div className="font-medium mt-0.5">
              {step.dependsOn?.length ? step.dependsOn.join(', ') : '--'}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {overlay?.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400 whitespace-pre-wrap break-words">
          <div className="font-medium mb-1">错误信息</div>
          {overlay.error}
        </div>
      )}

      {/* Output summary */}
      {overlay?.outputSummary && !overlay.error && (
        <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs whitespace-pre-wrap break-words">
          <div className="text-muted-foreground font-medium mb-1">输出摘要</div>
          <div className="max-h-40 overflow-y-auto">{overlay.outputSummary}</div>
        </div>
      )}

      {/* Output files for this step */}
      {fileList.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">本步产出 ({fileList.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {fileList.map(f => (
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
      )}

      {/* Agent config */}
      {step.type === 'agent' && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Agent 配置</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">预设</div>
              <div className="font-medium mt-0.5 break-all">{presetLabel ?? '--'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">模型</div>
              <div className="font-medium mt-0.5">{preferredModel ?? '沿用预设'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">角色</div>
              <div className="font-medium mt-0.5">{role ?? 'worker'}</div>
            </div>
          </div>

          {prompt && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">提示词 (Prompt)</div>
              <pre className="text-xs rounded-lg border border-border/50 bg-muted/20 p-3 whitespace-pre-wrap break-words max-h-60 overflow-y-auto font-sans">
                {prompt}
              </pre>
            </div>
          )}

          {expectedOutput && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">验收说明 (Expected Output)</div>
              <pre className="text-xs rounded-lg border border-border/50 bg-muted/20 p-3 whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-sans">
                {expectedOutput}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Control flow config */}
      {isControlFlow && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">控制流</div>
          {step.type === 'while' && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">模式</div>
                <div className="font-medium mt-0.5">{loopMode ?? 'while'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">最大迭代</div>
                <div className="font-medium mt-0.5">{loopMax ?? '--'}</div>
              </div>
            </div>
          )}
          <div>
            <div className="text-xs text-muted-foreground mb-1">条件</div>
            <pre className="text-[11px] rounded-lg border border-border/50 bg-muted/20 p-2 overflow-x-auto font-mono">
              {formatCondition(input.condition)}
            </pre>
          </div>
        </div>
      )}

      {step.type === 'for-each' && (
        <div className="text-xs">
          <span className="text-muted-foreground">遍历集合：</span>
          <span className="font-mono">{forEachCollection ?? '--'}</span>
        </div>
      )}

      {step.type === 'wait' && waitMs !== null && (
        <div className="text-xs">
          <span className="text-muted-foreground">等待时长：</span>
          <span className="font-medium">{waitMs >= 60_000 ? `${Math.round(waitMs / 60_000)} 分钟` : `${Math.round(waitMs / 1000)} 秒`}</span>
        </div>
      )}

      {/* Other config (catch-all) */}
      {hasOtherInput && (
        <details className="rounded-lg border border-border/40 bg-muted/10">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            其他配置
          </summary>
          <pre className="text-[11px] px-3 pb-3 overflow-x-auto font-mono">
            {JSON.stringify(otherInput, null, 2)}
          </pre>
        </details>
      )}

      {/* Policy */}
      {(step.policy?.timeoutMs || step.policy?.retry || step.policy?.continueOnFailure) && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">策略：</span>
          {step.policy.timeoutMs ? `超时 ${fmtTimeout(step.policy.timeoutMs)}` : ''}
          {step.policy.retry?.maximumAttempts && step.policy.retry.maximumAttempts > 1
            ? ` · 重试 ${step.policy.retry.maximumAttempts - 1} 次`
            : ''}
          {step.policy.continueOnFailure ? ' · 失败继续' : ''}
        </div>
      )}
    </div>
  );
}
