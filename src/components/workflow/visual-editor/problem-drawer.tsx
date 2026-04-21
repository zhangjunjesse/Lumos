'use client';

import { useEffect, useState } from 'react';
import type { ValidationSummary } from '@/lib/workflow/validate';
import type { ValidationIssue } from '@/lib/workflow/validate';

interface ProblemDrawerProps {
  summary: ValidationSummary;
  /** 点击 issue 时跳转并闪烁目标节点。 */
  onJumpToNode: (nodeId: string) => void;
  /** 校验失败后父层弹出"让 AI 修这些"时调用。 */
  onAskLlmToFix?: (issues: ValidationIssue[]) => void;
  /** LLM 刚生成 DSL 后触发一次自动展开。 */
  autoOpenToken?: unknown;
}

/**
 * 工作流 Problem 抽屉:
 * - 0 问题 → 不渲染
 * - 折叠态: 胶囊显示 "问题 N"
 * - 展开态: 列表,条目点击 → 跳转 + 闪烁节点
 * - autoOpenToken 变化且存在错误 → 自动展开一次
 */
export function ProblemDrawer({
  summary,
  onJumpToNode,
  onAskLlmToFix,
  autoOpenToken,
}: ProblemDrawerProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (autoOpenToken === undefined) return;
    if (summary.errorCount > 0) {
      // Defer to next task so we aren't synchronously setting state inside the
      // effect body — avoids the cascading-render lint rule while preserving
      // the intent of "auto-open once the parent signals via a new token".
      const id = setTimeout(() => setOpen(true), 0);
      return () => clearTimeout(id);
    }
  }, [autoOpenToken, summary.errorCount]);

  if (summary.issues.length === 0) return null;

  const total = summary.errorCount + summary.warningCount;
  const hasError = summary.errorCount > 0;
  const pillColor = hasError
    ? 'bg-red-500/95 text-white hover:bg-red-500'
    : 'bg-amber-500/95 text-amber-950 hover:bg-amber-500';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          'absolute left-3 bottom-3 z-10 px-3 h-7 rounded-full shadow-md',
          'text-[11px] font-semibold flex items-center gap-1.5',
          pillColor,
        ].join(' ')}
        title={`${summary.errorCount} 个错误 · ${summary.warningCount} 个警告`}
      >
        <span>{hasError ? '✕' : '△'}</span>
        <span>问题 · {total}</span>
      </button>
    );
  }

  return (
    <div className="absolute left-3 bottom-3 z-10 w-[360px] max-h-[260px] rounded-lg border border-border/70 bg-background/98 shadow-xl flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 text-[11px]">
        <span className={hasError ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}>
          {summary.errorCount > 0 ? `${summary.errorCount} 错误` : ''}
          {summary.errorCount > 0 && summary.warningCount > 0 ? ' · ' : ''}
          {summary.warningCount > 0 ? `${summary.warningCount} 警告` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {onAskLlmToFix && hasError && (
            <button
              type="button"
              onClick={() => onAskLlmToFix(summary.issues)}
              className="px-2 py-0.5 rounded text-[10px] bg-primary text-primary-foreground hover:bg-primary/90"
            >
              让 AI 修这些
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-accent"
            title="折叠"
          >
            ⌄
          </button>
        </div>
      </div>
      <ul className="overflow-auto flex-1">
        {summary.issues.map((issue, idx) => (
          <IssueRow
            key={`${issue.code}-${idx}`}
            issue={issue}
            onJump={() => issue.nodeId && onJumpToNode(issue.nodeId)}
          />
        ))}
      </ul>
    </div>
  );
}

function IssueRow({ issue, onJump }: { issue: ValidationIssue; onJump: () => void }) {
  const isError = issue.severity === 'error';
  return (
    <li>
      <button
        type="button"
        onClick={onJump}
        disabled={!issue.nodeId}
        className={[
          'w-full text-left px-3 py-1.5 border-b border-border/30 last:border-b-0',
          'hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-transparent',
          'flex gap-2 items-start',
        ].join(' ')}
      >
        <span
          className={[
            'mt-0.5 shrink-0 w-3.5 h-3.5 rounded-full text-[9px] font-bold leading-[14px] text-center text-white',
            isError ? 'bg-red-500' : 'bg-amber-500',
          ].join(' ')}
        >
          {isError ? '!' : '△'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-foreground truncate">
            {issue.nodeId && <span className="font-mono text-muted-foreground mr-1">{issue.nodeId}</span>}
            {issue.message}
          </div>
          <div className="text-[9px] text-muted-foreground font-mono">
            {issue.code}
            {issue.jsonPath ? ` · ${issue.jsonPath}` : ''}
          </div>
          {issue.hint && (
            <div className="text-[9px] text-muted-foreground italic">{issue.hint}</div>
          )}
        </div>
      </button>
    </li>
  );
}
