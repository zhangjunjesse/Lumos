'use client';

import { useCallback, useState } from 'react';
import type { ValidationIssue } from '@/lib/workflow/validate';

interface RefineResponse {
  workflowDsl?: unknown;
  validation?: { valid: boolean; errors: string[] };
  error?: string;
}

export interface AiFixState {
  loading: boolean;
  error: string | null;
  preview: { dsl: unknown; validation: RefineResponse['validation'] } | null;
}

interface UseAiFixOptions {
  /** 成功应用修复后回调,父层拿到新 DSL 并更新。 */
  onApply: (dsl: unknown) => void;
}

/**
 * W3-A: "让 AI 修这些" 按钮的交互 hook。
 * 1. fix(issues, currentDsl) → POST /api/workflow/builder/refine,预览新 DSL
 * 2. apply() 接受修复 / dismiss() 拒绝 / 重试自动 retry
 */
export function useAiFixIssues({ onApply }: UseAiFixOptions) {
  const [state, setState] = useState<AiFixState>({ loading: false, error: null, preview: null });

  const fix = useCallback(async (issues: ValidationIssue[], currentDsl: unknown) => {
    setState({ loading: true, error: null, preview: null });
    try {
      const res = await fetch('/api/workflow/builder/refine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instruction: '请根据下面列出的校验错误修复工作流。',
          currentDsl,
          issues,
        }),
      });
      const body = (await res.json()) as RefineResponse;
      if (!res.ok) {
        setState({ loading: false, error: body.error ?? `请求失败 (${res.status})`, preview: null });
        return;
      }
      if (!body.workflowDsl) {
        setState({ loading: false, error: 'AI 未返回有效 DSL', preview: null });
        return;
      }
      setState({ loading: false, error: null, preview: { dsl: body.workflowDsl, validation: body.validation } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      setState({ loading: false, error: msg, preview: null });
    }
  }, []);

  const apply = useCallback(() => {
    if (!state.preview) return;
    onApply(state.preview.dsl);
    setState({ loading: false, error: null, preview: null });
  }, [onApply, state.preview]);

  const dismiss = useCallback(() => {
    setState({ loading: false, error: null, preview: null });
  }, []);

  return { state, fix, apply, dismiss };
}
