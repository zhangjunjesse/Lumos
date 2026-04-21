'use client';

import type { WorkflowNode } from '@/lib/workflow/types-v3';
import { formatCondition, fmtTimeout } from './step-detail-helpers';

export function AgentConfigSection({
  presetLabel, preferredModel, role, prompt, expectedOutput,
}: {
  presetLabel: string | null;
  preferredModel: string | null;
  role: string | null;
  prompt: string | null;
  expectedOutput: string | null;
}) {
  return (
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
  );
}

export function ControlFlowSection({
  node, condition,
}: { node: WorkflowNode; condition: unknown }) {
  const loopMax = node.type === 'while' && typeof node.input.maxIterations === 'number' ? node.input.maxIterations : null;
  const loopMode = node.type === 'while' ? (node.input.mode ?? 'while') : null;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">控制流</div>
      {node.type === 'while' && (
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
          {formatCondition(condition)}
        </pre>
      </div>
    </div>
  );
}

export function ForEachSection({ collection }: { collection: string | null }) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">遍历集合：</span>
      <span className="font-mono">{collection ?? '--'}</span>
    </div>
  );
}

export function WaitSection({ durationMs }: { durationMs: number }) {
  const label = durationMs >= 60_000
    ? `${Math.round(durationMs / 60_000)} 分钟`
    : `${Math.round(durationMs / 1000)} 秒`;
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">等待时长：</span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

export function OtherInputSection({ other }: { other: Record<string, unknown> }) {
  if (Object.keys(other).length === 0) return null;
  return (
    <details className="rounded-lg border border-border/40 bg-muted/10">
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
        其他配置
      </summary>
      <pre className="text-[11px] px-3 pb-3 overflow-x-auto font-mono">
        {JSON.stringify(other, null, 2)}
      </pre>
    </details>
  );
}

export function PolicySection({ policy }: { policy: WorkflowNode['policy'] }) {
  if (!policy?.timeoutMs && !policy?.retry && !policy?.continueOnFailure) return null;
  const retryCount = policy.retry?.maximumAttempts && policy.retry.maximumAttempts > 1
    ? policy.retry.maximumAttempts - 1
    : 0;
  return (
    <div className="text-xs text-muted-foreground">
      <span className="font-medium">策略：</span>
      {policy.timeoutMs ? `超时 ${fmtTimeout(policy.timeoutMs)}` : ''}
      {retryCount > 0 ? ` · 重试 ${retryCount} 次` : ''}
      {policy.continueOnFailure ? ' · 失败继续' : ''}
    </div>
  );
}
