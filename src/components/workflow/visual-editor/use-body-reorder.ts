'use client';

import { useCallback, type MutableRefObject } from 'react';
import type { DslSpec } from './canvas-helpers';

/** 子节点重排(container body / if-else then+else)的回调,抽出避免 workflow-canvas 超 300 行。 */
export function useBodyReorder(
  dslRef: MutableRefObject<DslSpec>,
  selectedNodeId: string | null,
  onChange: (spec: DslSpec) => void,
) {
  return useCallback(
    (order: { body?: string[]; then?: string[]; else?: string[] }) => {
      if (!selectedNodeId) return;
      onChange({
        ...dslRef.current,
        steps: dslRef.current.steps.map(s => {
          if (s.id !== selectedNodeId) return s;
          const curInput = (s.input ?? {}) as Record<string, unknown>;
          return {
            ...s,
            input: {
              ...curInput,
              ...(order.body !== undefined ? { body: order.body } : {}),
              ...(order.then !== undefined ? { then: order.then } : {}),
              ...(order.else !== undefined ? { else: order.else } : {}),
            },
          };
        }),
      });
    },
    [dslRef, selectedNodeId, onChange],
  );
}
