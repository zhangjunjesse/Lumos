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
  computeContainerOwnership,
  isContainerNodeType,
} from '@/lib/workflow/dsl-graph-v3-helpers';
import { NODE_W } from '@/lib/workflow/dsl-graph-layout';
import {
  aggregateOf,
  type StepAggregateOverlay,
  type WorkflowDslStepOverlay,
} from '@/lib/workflow/step-overlay';
import type { WorkflowDSLV3 } from '@/lib/workflow/types-v3';

// ── Re-export for backwards compatibility ─────────────────────────────────
export type { WorkflowDslStepOverlay } from '@/lib/workflow/step-overlay';

// ── Types ──────────────────────────────────────────────────────────────────

interface WorkflowDslGraphProps {
  dsl: WorkflowDSLV3;
  presetNames?: Record<string, string>;
  selectedStepId?: string | null;
  onStepClick?: (stepId: string) => void;
  stepOverlays?: Record<string, WorkflowDslStepOverlay>;
  height?: number;
}

// ── Aggregate computation ──────────────────────────────────────────────────

/**
 * 容器(if-else/for-each/while)对应的所有嵌套后代节点集合。
 * V3 下通过边归属推导,不再依赖 input.body/then/else 数组。
 */
function computeAggregates(
  dsl: WorkflowDSLV3,
  overlays: Record<string, WorkflowDslStepOverlay> | undefined,
): Record<string, StepAggregateOverlay> {
  if (!overlays) return {};
  const ownership = computeContainerOwnership(dsl.nodes, dsl.edges);
  const out: Record<string, StepAggregateOverlay> = {};

  const collectDescendants = (containerId: string, acc: Set<string>): void => {
    const owned = ownership.childrenByContainer.get(containerId);
    if (!owned) return;
    const chains = [owned.then ?? [], owned.else ?? [], owned.body ?? []];
    for (const chain of chains) {
      for (const childId of chain) {
        if (acc.has(childId)) continue;
        acc.add(childId);
        collectDescendants(childId, acc);
      }
    }
  };

  for (const node of dsl.nodes) {
    if (!isContainerNodeType(node.type)) continue;
    const descendants = new Set<string>();
    collectDescendants(node.id, descendants);
    const agg = aggregateOf(Array.from(descendants), overlays);
    if (agg) out[node.id] = agg;
  }
  return out;
}

// ── Layer chip computation (top-level only) ───────────────────────────────

interface LayerChip { key: string; label: string }

function computeLayerChips(nodes: RFNode<StepNodeData>[]): LayerChip[] {
  if (nodes.length === 0) return [];
  const cols = new Map<number, number>();
  for (const n of nodes) {
    const mid = Math.round((n.position.x + NODE_W / 2) / 20) * 20;
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
  dsl,
  presetNames = {},
  selectedStepId,
  onStepClick,
  stepOverlays,
  height = 480,
}: WorkflowDslGraphProps) {
  const { nodes, edges, layerChips } = useMemo(() => {
    if (dsl.nodes.length === 0) return { nodes: [], edges: [], layerChips: [] };
    const g = dslToGraph(dsl, presetNames);
    return { nodes: g.nodes, edges: g.edges, layerChips: computeLayerChips(g.nodes) };
  }, [dsl, presetNames]);

  const { showRefs, refEdgeCount, displayEdges, toggle: toggleRefs } = useRefEdgeToggle(edges);

  const styledNodes = useMemo(
    () => nodes.map(n => ({ ...n, selected: n.id === selectedStepId })),
    [nodes, selectedStepId],
  );

  const aggregates = useMemo(
    () => computeAggregates(dsl, stepOverlays),
    [dsl, stepOverlays],
  );

  const handleNodeClick = useCallback((_: unknown, node: RFNode) => {
    onStepClick?.(node.id);
  }, [onStepClick]);

  if (dsl.nodes.length === 0) return null;

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
