'use client';

import { useMemo } from 'react';
import { validateWorkflowDsl, type ValidationSummary } from '@/lib/workflow/validate';

/**
 * 编辑器实时校验 hook。memoize 依赖 DSL 对象引用 (canvas 每次改动会返回新对象)。
 */
export function useWorkflowValidation(dsl: unknown): ValidationSummary {
  return useMemo(() => validateWorkflowDsl(dsl), [dsl]);
}
