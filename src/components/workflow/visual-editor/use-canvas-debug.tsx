'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import { useWorkflowDebugStore } from '@/stores/workflow-debug-store';
import { DebugContextMenu, type DebugMenuTarget } from './debug-context-menu';
import { DebugOutputPanel } from './debug-output-panel';

/**
 * 把画布的调试模式订阅 + 右键菜单状态抽成一个 hook,
 * 让 workflow-canvas.tsx 保持在 300 行以下。
 */
export function useCanvasDebug(workflowId: string | null) {
  const enabled = useWorkflowDebugStore(s => s.enabled);
  const snapshot = useWorkflowDebugStore(s => s.snapshot);
  const runningStepId = useWorkflowDebugStore(s => s.runningStepId);
  const detailStepId = useWorkflowDebugStore(s => s.detailStepId);
  const detailOutput = useWorkflowDebugStore(s => s.detailOutput);
  const detailLoading = useWorkflowDebugStore(s => s.detailLoading);
  const setWorkflowId = useWorkflowDebugStore(s => s.setWorkflowId);
  const runDebug = useWorkflowDebugStore(s => s.runDebug);
  const openStepDetail = useWorkflowDebugStore(s => s.openStepDetail);
  const closeStepDetail = useWorkflowDebugStore(s => s.closeStepDetail);
  const deleteStepCache = useWorkflowDebugStore(s => s.deleteStepCache);

  useEffect(() => { setWorkflowId(workflowId); }, [workflowId, setWorkflowId]);

  const [menuTarget, setMenuTarget] = useState<DebugMenuTarget | null>(null);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (!enabled) return;
      event.preventDefault();
      const n = node as Node<StepNodeData>;
      setMenuTarget({
        stepId: n.id,
        stepType: n.data.stepType,
        inContainer: !!n.data.containerId,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [enabled],
  );

  const menuMeta = menuTarget ? snapshot?.cachedSteps[menuTarget.stepId] : undefined;
  const detailStale = detailStepId ? snapshot?.cachedSteps[detailStepId]?.stale : undefined;

  const renderDetail = () => (enabled && detailStepId ? (
    <DebugOutputPanel
      stepId={detailStepId}
      workflowId={workflowId}
      latestRunId={snapshot?.latestRunId ?? null}
      output={detailOutput}
      loading={detailLoading}
      stale={detailStale}
      onClose={closeStepDetail}
      onDelete={() => deleteStepCache(detailStepId, false)}
    />
  ) : null);

  const renderMenu = () => (menuTarget ? (
    <DebugContextMenu
      target={menuTarget}
      meta={menuMeta}
      running={runningStepId === menuTarget.stepId}
      onRunTo={(id) => runDebug('run-to', id)}
      onRerunOnly={(id) => runDebug('rerun-only', id)}
      onContinueFrom={(id) => runDebug('continue-from', id)}
      onViewOutput={(id) => void openStepDetail(id)}
      onDeleteCache={(id, cascade) => void deleteStepCache(id, cascade)}
      onClose={() => setMenuTarget(null)}
    />
  ) : null);

  return {
    enabled,
    cache: snapshot?.cachedSteps,
    runningStepId,
    onNodeContextMenu,
    renderDetail,
    renderMenu,
  };
}
