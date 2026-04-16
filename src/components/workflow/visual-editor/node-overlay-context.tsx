'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { StepAggregateOverlay, WorkflowDslStepOverlay } from '@/lib/workflow/step-overlay';

interface NodeOverlayCtxValue {
  overlays?: Record<string, WorkflowDslStepOverlay>;
  aggregates?: Record<string, StepAggregateOverlay>;
}

const NodeOverlayContext = createContext<NodeOverlayCtxValue>({});

export function NodeOverlayProvider({
  overlays,
  aggregates,
  children,
}: NodeOverlayCtxValue & { children: ReactNode }) {
  const value = useMemo(() => ({ overlays, aggregates }), [overlays, aggregates]);
  return <NodeOverlayContext.Provider value={value}>{children}</NodeOverlayContext.Provider>;
}

export function useNodeOverlay(stepId: string): WorkflowDslStepOverlay | undefined {
  return useContext(NodeOverlayContext).overlays?.[stepId];
}

export function useNodeAggregate(stepId: string): StepAggregateOverlay | undefined {
  return useContext(NodeOverlayContext).aggregates?.[stepId];
}
