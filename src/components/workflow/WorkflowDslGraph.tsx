'use client';

import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  type Node as RFNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NODE_TYPES } from './visual-editor/nodes';
import { NodeOverlayProvider } from './visual-editor/node-overlay-context';
import { RefEdgeToggle, useRefEdgeToggle } from './visual-editor/ref-edge-toggle';
import {
  dslToGraph,
  type StepNodeData,
} from '@/lib/workflow/dsl-graph-converter';
import {
  getBodyIds,
  isContainer,
  NODE_W,
} from '@/lib/workflow/dsl-graph-layout';
import {
  aggregateOf,
  type StepAggregateOverlay,
  type WorkflowDslStepOverlay,
} from '@/lib/workflow/step-overlay';

// ── Re-export for backwards compatibility ─────────────────────────────────
export type { WorkflowDslStepOverlay } from '@/lib/workflow/step-overlay';

// ── Types ──────────────────────────────────────────────────────────────────

interface DslStep {
  id: string;
  type: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
  policy?: { timeoutMs?: number };
  metadata?: { position?: { x: number; y: number } };
}

interface WorkflowDslGraphProps {
  steps: DslStep[];
  presetNames?: Record<string, string>;
  selectedStepId?: string | null;
  onStepClick?: (stepId: string) => void;
  stepOverlays?: Record<string, WorkflowDslStepOverlay>;
  height?: number;
}

// ── Aggregate computation ──────────────────────────────────────────────────

function collectDescendants(
  stepId: string,
  stepMap: Map<string, DslStep>,
): string[] {
  const s = stepMap.get(stepId);
  if (!s) return [];
  const ls = { id: s.id, type: s.type, input: s.input };
  if (!isContainer(ls)) return [];
  const result: string[] = [];
  for (const id of getBodyIds(ls)) {
    result.push(id);
    result.push(...collectDescendants(id, stepMap));
  }
  return result;
}

function computeAggregates(
  steps: DslStep[],
  overlays: Record<string, WorkflowDslStepOverlay> | undefined,
): Record<string, StepAggregateOverlay> {
  if (!overlays) return {};
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const out: Record<string, StepAggregateOverlay> = {};
  for (const s of steps) {
    const ls = { id: s.id, type: s.type, input: s.input };
    if (!isContainer(ls)) continue;
    const agg = aggregateOf(collectDescendants(s.id, stepMap), overlays);
    if (agg) out[s.id] = agg;
  }
  return out;
}

// ── Layer chip computation (top-level only) ───────────────────────────────

interface LayerChip { key: string; label: string }

function computeLayerChips(nodes: RFNode<StepNodeData>[]): LayerChip[] {
  const top = nodes.filter(n => !n.parentId);
  if (top.length === 0) return [];
  const cols = new Map<number, number>();
  for (const n of top) {
    const w = (n.style?.width as number | undefined) ?? NODE_W;
    const mid = Math.round((n.position.x + w / 2) / 20) * 20;
    cols.set(mid, (cols.get(mid) ?? 0) + 1);
  }
  const sorted = Array.from(cols.entries()).sort((a, b) => a[0] - b[0]);
  return sorted.map(([, count], i) => ({
    key: `l${i}`,
    label: count > 1 ? `第 ${i + 1} 层 · 并行 ${count}` : `第 ${i + 1} 层`,
  }));
}

// ── Component ─────────────────────────────────────────────────────────────

function WorkflowDslGraphInner({
  steps,
  presetNames = {},
  selectedStepId,
  onStepClick,
  stepOverlays,
  height = 480,
}: WorkflowDslGraphProps) {
  const { nodes, edges, layerChips } = useMemo(() => {
    if (steps.length === 0) return { nodes: [], edges: [], layerChips: [] };
    const spec = { version: '2.0.0', name: '', steps };
    const g = dslToGraph(spec, presetNames);
    return { nodes: g.nodes, edges: g.edges, layerChips: computeLayerChips(g.nodes) };
  }, [steps, presetNames]);

  const { showRefs, refEdgeCount, displayEdges, toggle: toggleRefs } = useRefEdgeToggle(edges);

  const styledNodes = useMemo(
    () => nodes.map(n => ({ ...n, selected: n.id === selectedStepId })),
    [nodes, selectedStepId],
  );

  const aggregates = useMemo(
    () => computeAggregates(steps, stepOverlays),
    [steps, stepOverlays],
  );

  const handleNodeClick = useCallback((_: unknown, node: RFNode) => {
    onStepClick?.(node.id);
  }, [onStepClick]);

  if (steps.length === 0) return null;

  return (
    <NodeOverlayProvider overlays={stepOverlays} aggregates={aggregates}>
      <div
        className="rounded-2xl border border-border/60 overflow-hidden bg-gradient-to-br from-violet-500/5 via-background to-sky-500/5"
        style={{ height }}
      >
        <ReactFlow
          nodes={styledNodes}
          edges={displayEdges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          elementsSelectable
          onNodeClick={handleNodeClick}
          defaultEdgeOptions={{
            type: 'bezier',
            style: { stroke: '#64748b', strokeWidth: 1.5 },
          }}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} className="!shadow-sm" />
          <MiniMap className="!shadow-sm !border-border/40" pannable zoomable />
          <RefEdgeToggle show={showRefs} count={refEdgeCount} onToggle={toggleRefs} />
          {layerChips.length > 0 && (
            <Panel position="top-left" className="pointer-events-none !m-2">
              <div className="flex flex-wrap gap-1">
                {layerChips.map(l => (
                  <span
                    key={l.key}
                    className="rounded-full border border-border/60 bg-background/90 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                  >
                    {l.label}
                  </span>
                ))}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </NodeOverlayProvider>
  );
}

export function WorkflowDslGraph(props: WorkflowDslGraphProps) {
  return (
    <ReactFlowProvider>
      <WorkflowDslGraphInner {...props} />
    </ReactFlowProvider>
  );
}
