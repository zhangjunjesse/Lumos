'use client';

import { useMemo, useState } from 'react';
import { Panel, type Edge } from '@xyflow/react';

/** Hook: filter out ref edges by default, expose a toggle. */
export function useRefEdgeToggle(edges: Edge[]) {
  const [showRefs, setShowRefs] = useState(false);
  const refEdgeCount = useMemo(() => edges.filter(e => e.data?.kind === 'ref').length, [edges]);
  const displayEdges = useMemo(
    () => (showRefs ? edges : edges.filter(e => e.data?.kind !== 'ref')),
    [edges, showRefs],
  );
  return { showRefs, refEdgeCount, displayEdges, toggle: () => setShowRefs(v => !v) };
}

interface RefEdgeToggleProps {
  show: boolean;
  count: number;
  onToggle: () => void;
}

/** Floating button for toggling the dashed "data reference" edges. */
export function RefEdgeToggle({ show, count, onToggle }: RefEdgeToggleProps) {
  if (count <= 0) return null;
  return (
    <Panel position="top-right" className="!m-2">
      <button
        type="button"
        onClick={onToggle}
        title="切换数据引用虚线"
        className="rounded-full border border-border/60 bg-background/95 px-2.5 py-1 text-[10px] font-medium shadow-sm hover:bg-accent flex items-center gap-1.5"
      >
        <span className="inline-block w-4 border-t border-dashed border-slate-400" />
        {show ? `隐藏数据引用 (${count})` : `显示数据引用 (${count})`}
      </button>
    </Panel>
  );
}
