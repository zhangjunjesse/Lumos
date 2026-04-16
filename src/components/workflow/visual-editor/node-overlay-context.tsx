'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { StepAggregateOverlay, WorkflowDslStepOverlay } from '@/lib/workflow/step-overlay';
import type { DebugStepCacheMeta } from '@/lib/workflow/debug-types';

export interface NodeDebugInfo {
  meta?: DebugStepCacheMeta;
  running: boolean;
}

interface NodeOverlayCtxValue {
  overlays?: Record<string, WorkflowDslStepOverlay>;
  aggregates?: Record<string, StepAggregateOverlay>;
  debugEnabled?: boolean;
  debugCache?: Record<string, DebugStepCacheMeta>;
  debugRunningStepId?: string | null;
}

const NodeOverlayContext = createContext<NodeOverlayCtxValue>({});

export function NodeOverlayProvider({
  overlays,
  aggregates,
  debugEnabled,
  debugCache,
  debugRunningStepId,
  children,
}: NodeOverlayCtxValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ overlays, aggregates, debugEnabled, debugCache, debugRunningStepId }),
    [overlays, aggregates, debugEnabled, debugCache, debugRunningStepId],
  );
  return <NodeOverlayContext.Provider value={value}>{children}</NodeOverlayContext.Provider>;
}

export function useNodeOverlay(stepId: string): WorkflowDslStepOverlay | undefined {
  return useContext(NodeOverlayContext).overlays?.[stepId];
}

export function useNodeAggregate(stepId: string): StepAggregateOverlay | undefined {
  return useContext(NodeOverlayContext).aggregates?.[stepId];
}

export function useNodeDebug(stepId: string): NodeDebugInfo | null {
  const ctx = useContext(NodeOverlayContext);
  if (!ctx.debugEnabled) return null;
  return {
    meta: ctx.debugCache?.[stepId],
    running: ctx.debugRunningStepId === stepId,
  };
}
