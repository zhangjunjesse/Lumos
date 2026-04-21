'use client';

import type { AiFixState } from './use-ai-fix-issues';

interface AiFixPreviewProps {
  state: AiFixState;
  onApply: () => void;
  onDismiss: () => void;
}

/**
 * W3-A: "让 AI 修这些" 的浮层预览条。
 * - loading → 转圈提示
 * - error → 红条 + 重试按钮 (点击等同 dismiss)
 * - preview → 绿/黄条 + 剩余问题数 + 应用/放弃
 */
export function AiFixPreview({ state, onApply, onDismiss }: AiFixPreviewProps) {
  if (state.loading) {
    return (
      <div className="absolute left-3 right-3 top-3 z-10 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] text-primary flex items-center gap-2 shadow-sm">
        <span className="inline-block w-3 h-3 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
        <span>AI 正在分析并生成修复方案…</span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="absolute left-3 right-3 top-3 z-10 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive flex items-center gap-2 shadow-sm">
        <span>✕</span>
        <span className="flex-1 truncate" title={state.error}>修复失败: {state.error}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="px-2 py-0.5 rounded text-[10px] hover:bg-destructive/20"
        >
          关闭
        </button>
      </div>
    );
  }

  if (!state.preview) return null;

  const remaining = state.preview.validation?.errors?.length ?? 0;
  const clean = remaining === 0;

  return (
    <div
      className={[
        'absolute left-3 right-3 top-3 z-10 rounded-md border px-3 py-1.5 text-[11px] flex items-center gap-2 shadow-sm',
        clean
          ? 'border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400'
          : 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      ].join(' ')}
    >
      <span>{clean ? '✓' : '△'}</span>
      <span className="flex-1">
        AI 已生成修复方案
        {clean ? ',已消除全部错误' : `,剩余 ${remaining} 个错误,可继续修`}
      </span>
      <button
        type="button"
        onClick={onApply}
        className="px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] hover:bg-primary/90"
      >
        应用
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="px-2 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-accent"
      >
        放弃
      </button>
    </div>
  );
}
