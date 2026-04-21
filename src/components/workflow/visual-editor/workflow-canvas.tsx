'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NODE_TYPES } from './nodes';
import { NodePalette } from './node-palette';
import { PropertiesPanel } from './properties-panel';
import {
  dslToGraph,
  graphToDsl,
  removeNodeFromDsl,
  type StepNodeData,
} from '@/lib/workflow/dsl-graph-converter';
import {
  countOutgoingByKind,
  extractBodyChain,
  extractIfElseBranches,
  extractParallelBranches,
  reorderParallelBranches,
  syncOnErrorEdge,
} from '@/lib/workflow/dsl-graph-v3-helpers';
import type { EdgeKind, WorkflowDSLV3, WorkflowEdge, WorkflowNode } from '@/lib/workflow/types-v3';
import { RefEdgeToggle, useRefEdgeToggle } from './ref-edge-toggle';
import type { BodyChildInfo } from './body-manager';
import { defaultNodeForType, genId, type DslSpec } from './canvas-helpers';
import { NodeOverlayProvider } from './node-overlay-context';
import { useCanvasDebug } from './use-canvas-debug';
import { useBodyReorder } from './use-body-reorder';
import { useWorkflowValidation } from './use-workflow-validation';
import { ProblemDrawer } from './problem-drawer';
import { useAiFixIssues } from './use-ai-fix-issues';
import { AiFixPreview } from './ai-fix-preview';
import type { ValidationIssue } from '@/lib/workflow/validate';

interface WorkflowCanvasProps {
  dsl: DslSpec;
  presetNames?: Record<string, string>;
  onChange: (dsl: DslSpec) => void;
  height?: number;
  workflowId?: string | null;
  /** 刚触发 LLM 生成的 token — 值变化且校验有错误时,Problem 抽屉自动展开一次。 */
  llmGenerationToken?: unknown;
}

/**
 * 根据源节点类型 + 现有出边,推断新连边该用哪种 kind。
 * - if-else: 先 then, 后 else
 * - for-each/while: 先 body, 后 next
 * - parallel: 全部 next, 自动递增 branchIndex
 * - 其它: 首条 next, 否则拒绝
 */
function inferEdgeKindAndIndex(
  dsl: WorkflowDSLV3,
  from: string,
): { kind: EdgeKind; branchIndex?: number } | null {
  const node = dsl.nodes.find((n) => n.id === from);
  if (!node) return null;
  const has = (kind: EdgeKind) => countOutgoingByKind(dsl.edges, from, kind) > 0;
  if (node.type === 'if-else') {
    if (!has('then')) return { kind: 'then' };
    if (!has('else')) return { kind: 'else' };
    return null;
  }
  if (node.type === 'for-each' || node.type === 'while') {
    if (!has('body')) return { kind: 'body' };
    if (!has('next')) return { kind: 'next' };
    return null;
  }
  if (node.type === 'parallel') {
    const count = countOutgoingByKind(dsl.edges, from, 'next');
    return { kind: 'next', branchIndex: count };
  }
  return has('next') ? null : { kind: 'next' };
}

function computeHoverGroup(
  nodes: Node<StepNodeData>[],
  hoveredId: string | null,
): Set<string> {
  const empty = new Set<string>();
  if (!hoveredId) return empty;
  const target = nodes.find((n) => n.id === hoveredId);
  if (!target) return empty;
  const children = nodes.filter((n) => n.data.containerId === hoveredId).map((n) => n.id);
  if (children.length > 0) return new Set([hoveredId, ...children]);
  const parent = target.data.containerId;
  if (!parent) return empty;
  const siblings = nodes.filter((n) => n.data.containerId === parent).map((n) => n.id);
  return new Set([parent, ...siblings]);
}

function WorkflowCanvasInner({
  dsl, presetNames = {}, onChange, height = 480, workflowId = null,
  llmGenerationToken,
}: WorkflowCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [flashNodeId, setFlashNodeId] = useState<string | null>(null);
  const { getNodes, getEdges, screenToFlowPosition } = useReactFlow();
  const dslRef = useRef(dsl);
  useEffect(() => {
    dslRef.current = dsl;
  }, [dsl]);

  const initial = useMemo(() => dslToGraph(dsl, presetNames), [dsl, presetNames]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  const prevDslRef = useRef(dsl);
  useEffect(() => {
    if (prevDslRef.current === dsl) return;
    prevDslRef.current = dsl;
    const graph = dslToGraph(dsl, presetNames);
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [dsl, presetNames, setNodes, setEdges]);

  /** 先把画布当前位置 sync 回 dsl, 再跑 apply 做结构变更, 最后 emit。 */
  const mutate = useCallback(
    (apply: (next: WorkflowDSLV3) => WorkflowDSLV3) => {
      const currentNodes = getNodes() as Node<StepNodeData>[];
      const currentEdges = getEdges();
      const synced = graphToDsl(currentNodes, currentEdges, dslRef.current);
      onChange(apply(synced));
    },
    [getNodes, getEdges, onChange],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      mutate((next) => {
        const inferred = inferEdgeKindAndIndex(next, params.source!);
        if (!inferred) return next;
        const dup = next.edges.some(
          (e) => e.from === params.source && e.to === params.target && e.kind === inferred.kind,
        );
        if (dup) return next;
        const newEdge: WorkflowEdge = {
          from: params.source!,
          to: params.target!,
          kind: inferred.kind,
          ...(inferred.branchIndex !== undefined ? { branchIndex: inferred.branchIndex } : {}),
        };
        return { ...next, edges: [...next.edges, newEdge] };
      });
    },
    [mutate],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/workflow-node-type');
      if (!type || !reactFlowWrapper.current) return;
      const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = genId(type);
      const seed = defaultNodeForType(type as WorkflowNode['type']);
      const newNode = {
        ...seed,
        id,
        metadata: { position: { x: flowPos.x - 90, y: flowPos.y - 26 } },
      } as WorkflowNode;
      mutate((next) => ({ ...next, nodes: [...next.nodes, newNode] }));
    },
    [mutate, screenToFlowPosition],
  );

  const onNodeDragStop = useCallback(() => {
    mutate((next) => next);
  }, [mutate]);

  const onNodeMouseEnter = useCallback((_: unknown, node: Node) => setHoveredId(node.id), []);
  const onNodeMouseLeave = useCallback(() => setHoveredId(null), []);
  const onNodeClick = useCallback((_: unknown, node: Node) => setSelectedNodeId(node.id), []);
  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) as Node<StepNodeData> | undefined;

  const dbg = useCanvasDebug(workflowId ?? null);

  const handleNodeUpdate = useCallback(
    (data: StepNodeData) => {
      if (!selectedNodeId) return;
      mutate((next) => {
        const updated: WorkflowDSLV3 = {
          ...next,
          nodes: next.nodes.map((n) => (n.id === selectedNodeId ? data.node : n)),
        };
        return syncOnErrorEdge(updated, data.node.id);
      });
    },
    [mutate, selectedNodeId],
  );

  const handleReorderParallelBranches = useCallback(
    (order: string[]) => {
      if (!selectedNodeId) return;
      mutate((next) => reorderParallelBranches(next, selectedNodeId, order));
    },
    [mutate, selectedNodeId],
  );

  const handleReorderBody = useBodyReorder(dslRef, selectedNodeId, onChange);

  const childNodes = useMemo<Record<string, BodyChildInfo>>(() => {
    const m: Record<string, BodyChildInfo> = {};
    for (const n of nodes) {
      m[n.id] = { stepId: n.id, label: n.data.label, stepType: n.data.stepType };
    }
    return m;
  }, [nodes]);

  const availableChildIds = useMemo(
    () => (nodes as Node<StepNodeData>[])
      .filter((n) => n.id !== selectedNodeId && !n.data.containerId)
      .map((n) => n.id),
    [nodes, selectedNodeId],
  );

  const branchIdsForSelected = useMemo(() => {
    if (!selectedNode) return { bodyIds: [], thenIds: [], elseIds: [] };
    const { stepType } = selectedNode.data;
    if (stepType === 'if-else') {
      const b = extractIfElseBranches(selectedNode.id, dsl.edges);
      return { bodyIds: [], thenIds: b.thenChain, elseIds: b.elseChain };
    }
    if (stepType === 'for-each' || stepType === 'while') {
      return { bodyIds: extractBodyChain(selectedNode.id, dsl.edges), thenIds: [], elseIds: [] };
    }
    return { bodyIds: [], thenIds: [], elseIds: [] };
  }, [selectedNode, dsl.edges]);

  const parallelBranchIds = useMemo(() => {
    if (!selectedNode || selectedNode.data.stepType !== 'parallel') return [];
    return extractParallelBranches(selectedNode.id, dsl.edges).map((b) => b.targetId);
  }, [selectedNode, dsl.edges]);

  const handleNodeDelete = useCallback(() => {
    if (!selectedNodeId) return;
    mutate((next) => removeNodeFromDsl(next, selectedNodeId));
    setSelectedNodeId(null);
  }, [mutate, selectedNodeId]);

  const hoveredGroup = useMemo(
    () => computeHoverGroup(nodes as Node<StepNodeData>[], hoveredId),
    [nodes, hoveredId],
  );

  const revealedEdges = useMemo(() => {
    if (!hoveredId) return edges;
    return edges.map((e) => {
      if (e.data?.kind !== 'loop-back') return e;
      const show = e.source === hoveredId || e.target === hoveredId
        || hoveredGroup.has(e.source) || hoveredGroup.has(e.target);
      return show ? { ...e, hidden: false } : e;
    });
  }, [edges, hoveredId, hoveredGroup]);

  const { showRefs, refEdgeCount, displayEdges, toggle: toggleRefs } = useRefEdgeToggle(revealedEdges);

  const validation = useWorkflowValidation(dsl);

  const [aiFixToken, setAiFixToken] = useState(0);
  const aiFix = useAiFixIssues({
    onApply: (newDsl) => {
      onChange(newDsl as DslSpec);
      setAiFixToken((t) => t + 1);
    },
  });

  const handleAskLlmToFix = useCallback(
    (issues: ValidationIssue[]) => { void aiFix.fix(issues, dsl); },
    [aiFix, dsl],
  );

  const jumpToNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setFlashNodeId(nodeId);
    window.setTimeout(() => setFlashNodeId((curr) => (curr === nodeId ? null : curr)), 1200);
  }, []);

  const drawerAutoOpenToken = aiFixToken > 0 ? aiFixToken : llmGenerationToken;

  return (
    <NodeOverlayProvider
      debugEnabled={dbg.enabled}
      debugCache={dbg.cache}
      debugRunningStepId={dbg.runningStepId}
      hoveredId={hoveredId}
      hoveredGroup={hoveredGroup}
      issuesByNodeId={validation.issuesByNodeId}
      flashNodeId={flashNodeId}
    >
      <div className="flex rounded-xl border border-border/60 overflow-hidden" style={{ height }}>
        <NodePalette />
        <div ref={reactFlowWrapper} className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onNodeContextMenu={dbg.onNodeContextMenu}
            nodeTypes={NODE_TYPES}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-gradient-to-br from-violet-500/5 via-background to-sky-500/5"
          >
            <Background gap={16} size={1} />
            <Controls showInteractive={false} className="!shadow-sm" />
            <MiniMap className="!shadow-sm !border-border/40" pannable zoomable />
            <RefEdgeToggle show={showRefs} count={refEdgeCount} onToggle={toggleRefs} />
          </ReactFlow>
          <AiFixPreview
            state={aiFix.state}
            onApply={aiFix.apply}
            onDismiss={aiFix.dismiss}
          />
          <ProblemDrawer
            summary={validation}
            onJumpToNode={jumpToNode}
            onAskLlmToFix={handleAskLlmToFix}
            autoOpenToken={drawerAutoOpenToken}
          />
          {dbg.renderDetail()}
        </div>
        {selectedNode && (
          <PropertiesPanel
            data={selectedNode.data}
            allStepIds={nodes.map((n) => n.id)}
            onUpdate={handleNodeUpdate}
            onDelete={handleNodeDelete}
            onClose={() => setSelectedNodeId(null)}
            childNodes={childNodes}
            availableChildIds={availableChildIds}
            bodyIds={branchIdsForSelected.bodyIds}
            thenIds={branchIdsForSelected.thenIds}
            elseIds={branchIdsForSelected.elseIds}
            onReorderBody={handleReorderBody}
            parallelBranchIds={parallelBranchIds}
            onReorderParallelBranches={handleReorderParallelBranches}
          />
        )}
      </div>
      {dbg.renderMenu()}
    </NodeOverlayProvider>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
