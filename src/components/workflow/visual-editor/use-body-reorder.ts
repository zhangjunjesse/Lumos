'use client';

import { useCallback, type MutableRefObject } from 'react';
import { rewriteContainerChain } from '@/lib/workflow/dsl-graph-v3-helpers';
import type { DslSpec } from './canvas-helpers';

/**
 * 子节点重排(container body / if-else then+else)的回调。
 * V3 下顺序 = 容器出边 + body/then/else 内部的 next 链,直接通过
 * `rewriteContainerChain` 重写边,而不是再写 input.body/then/else 数组。
 */
export function useBodyReorder(
  dslRef: MutableRefObject<DslSpec>,
  selectedNodeId: string | null,
  onChange: (spec: DslSpec) => void,
) {
  return useCallback(
    (order: { body?: string[]; then?: string[]; else?: string[] }) => {
      if (!selectedNodeId) return;
      let next = dslRef.current;
      if (order.body !== undefined) {
        next = rewriteContainerChain(selectedNodeId, 'body', order.body, next);
      }
      if (order.then !== undefined) {
        next = rewriteContainerChain(selectedNodeId, 'then', order.then, next);
      }
      if (order.else !== undefined) {
        next = rewriteContainerChain(selectedNodeId, 'else', order.else, next);
      }
      onChange(next);
    },
    [dslRef, selectedNodeId, onChange],
  );
}
