'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { StepAggregateOverlay, WorkflowDslStepOverlay } from '@/lib/workflow/step-overlay';
import type { DebugStepCacheMeta } from '@/lib/workflow/debug-types';
import type { ValidationIssue } from '@/lib/workflow/validate';

export interface NodeDebugInfo {
  meta?: DebugStepCacheMeta;
  running: boolean;
}

export interface NodeValidationInfo {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface NodeOverlayCtxValue {
  overlays?: Record<string, WorkflowDslStepOverlay>;
  aggregates?: Record<string, StepAggregateOverlay>;
  debugEnabled?: boolean;
  debugCache?: Record<string, DebugStepCacheMeta>;
  debugRunningStepId?: string | null;
  /** 鼠标悬停的节点 id */
  hoveredId?: string | null;
  /** 与 hoveredId 属于同一控制流分组 (loop body / then / else) 的节点 id 集合 */
  hoveredGroup?: Set<string>;
  /** 每个节点的校验问题 (error / warning) */
  issuesByNodeId?: Record<string, ValidationIssue[]>;
  /** 编辑器引导高亮的节点 — 点击 Problem 抽屉条目后闪烁。 */
  flashNodeId?: string | null;
}

const NodeOverlayContext = createContext<NodeOverlayCtxValue>({});

export function NodeOverlayProvider({
  overlays,
  aggregates,
  debugEnabled,
  debugCache,
  debugRunningStepId,
  hoveredId,
  hoveredGroup,
  issuesByNodeId,
  flashNodeId,
  children,
}: NodeOverlayCtxValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({
      overlays, aggregates, debugEnabled, debugCache, debugRunningStepId,
      hoveredId, hoveredGroup, issuesByNodeId, flashNodeId,
    }),
    [
      overlays, aggregates, debugEnabled, debugCache, debugRunningStepId,
      hoveredId, hoveredGroup, issuesByNodeId, flashNodeId,
    ],
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

/** 返回这个节点是否在当前 hover 的分组内 (不包括 hover 节点本身)。 */
export function useNodeGroupHighlight(stepId: string): boolean {
  const ctx = useContext(NodeOverlayContext);
  if (!ctx.hoveredGroup) return false;
  if (stepId === ctx.hoveredId) return false;
  return ctx.hoveredGroup.has(stepId);
}

/** 节点的校验问题集合,按 severity 分类;校验器未挂载时返回 null。 */
export function useNodeValidation(stepId: string): NodeValidationInfo | null {
  const ctx = useContext(NodeOverlayContext);
  if (!ctx.issuesByNodeId) return null;
  const list = ctx.issuesByNodeId[stepId];
  if (!list || list.length === 0) return { errors: [], warnings: [] };
  const errors = list.filter((i) => i.severity === 'error');
  const warnings = list.filter((i) => i.severity === 'warning');
  return { errors, warnings };
}

/** 当前被 Problem 抽屉点亮的节点 id。节点读取此值可触发闪烁动画。 */
export function useNodeFlash(stepId: string): boolean {
  const ctx = useContext(NodeOverlayContext);
  return ctx.flashNodeId === stepId;
}
