'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NODE_TYPES } from './nodes';
import { NodePalette } from './node-palette';
import { PropertiesPanel } from './properties-panel';
import {
  dslToGraph,
  graphToDsl,
  stepTypeToNodeType,
  type StepNodeData,
} from '@/lib/workflow/dsl-graph-converter';
import { findContainerAt, type DropTarget } from './drop-helpers';
import { RefEdgeToggle, useRefEdgeToggle } from './ref-edge-toggle';
import type { BodyChildInfo } from './body-manager';
import {
  applyDropTargetFlag,
  defaultInputForType,
  genId,
  type DslSpec,
} from './canvas-helpers';

interface WorkflowCanvasProps {
  dsl: DslSpec;
  presetNames?: Record<string, string>;
  onChange: (dsl: DslSpec) => void;
  height?: number;
}

function WorkflowCanvasInner({ dsl, presetNames = {}, onChange, height = 480 }: WorkflowCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
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

  const syncDsl = useCallback(() => {
    const currentNodes = getNodes() as Node<StepNodeData>[];
    const currentEdges = getEdges();
    onChange(graphToDsl(currentNodes, currentEdges, dslRef.current));
  }, [getNodes, getEdges, onChange]);

  const emitDsl = useCallback((nextNodes: Node<StepNodeData>[], nextEdges: Edge[]) => {
    onChange(graphToDsl(nextNodes, nextEdges, dslRef.current));
  }, [onChange]);

  const onConnect = useCallback(
    (params: Connection) => {
      const nextEdges = addEdge({ ...params, id: `dep-${params.source}-${params.target}` }, edges);
      setEdges(nextEdges);
      emitDsl(nodes as Node<StepNodeData>[], nextEdges);
    },
    [edges, emitDsl, nodes, setEdges],
  );

  const flowPosFromEvent = useCallback(
    (clientX: number, clientY: number) => screenToFlowPosition({ x: clientX, y: clientY }),
    [screenToFlowPosition],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const flowPos = flowPosFromEvent(event.clientX, event.clientY);
    const target = findContainerAt(nodes as Node<StepNodeData>[], flowPos);
    setDropTargetId(target?.containerId ?? null);
  }, [flowPosFromEvent, nodes]);

  const onDragLeave = useCallback(() => setDropTargetId(null), []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDropTargetId(null);
      const type = event.dataTransfer.getData('application/workflow-node-type');
      if (!type || !reactFlowWrapper.current) return;

      const flowPos = flowPosFromEvent(event.clientX, event.clientY);
      const target: DropTarget | null = findContainerAt(nodes as Node<StepNodeData>[], flowPos);
      const stepId = genId(type);

      const base: Node<StepNodeData> = {
        id: stepId,
        type: stepTypeToNodeType(type),
        position: target ? target.relativePos : { x: flowPos.x - 90, y: flowPos.y - 26 },
        ...(target ? { parentId: target.containerId, extent: 'parent' as const } : {}),
        data: {
          stepId, stepType: type,
          label: type === 'agent' ? stepId : type.toUpperCase(),
          input: defaultInputForType(type), dependsOn: [],
          ...(target?.branch ? { branch: target.branch } : {}),
        },
      };

      const nextNodes = [...nodes, base];
      setNodes(nextNodes);
      emitDsl(nextNodes, edges);
    },
    [edges, emitDsl, flowPosFromEvent, nodes, setNodes],
  );

  const onNodeDrag = useCallback((event: React.MouseEvent, dragged: Node) => {
    const flowPos = flowPosFromEvent(event.clientX, event.clientY);
    const target = findContainerAt(nodes as Node<StepNodeData>[], flowPos, dragged.id);
    const candidate = target?.containerId ?? null;
    if (candidate === dragged.parentId) {
      setDropTargetId(null);
    } else {
      setDropTargetId(candidate);
    }
  }, [flowPosFromEvent, nodes]);

  const onNodeDragStop = useCallback((event: React.MouseEvent, dragged: Node) => {
    setDropTargetId(null);
    const flowPos = flowPosFromEvent(event.clientX, event.clientY);
    const target = findContainerAt(nodes as Node<StepNodeData>[], flowPos, dragged.id);
    const currentParent = dragged.parentId ?? null;
    const nextParent = target?.containerId ?? null;

    if (currentParent === nextParent) {
      syncDsl();
      return;
    }

    const nextNodes = (nodes as Node<StepNodeData>[]).map(n => {
      if (n.id !== dragged.id) return n;
      if (nextParent && target) {
        return {
          ...n,
          parentId: target.containerId,
          extent: 'parent' as const,
          position: target.relativePos,
          data: target.branch ? { ...n.data, branch: target.branch } : n.data,
        };
      }
      const { ...rest } = n;
      delete (rest as { parentId?: string }).parentId;
      delete (rest as { extent?: unknown }).extent;
      return {
        ...rest,
        position: { x: flowPos.x - 90, y: flowPos.y - 26 },
        data: { ...n.data, branch: undefined } as StepNodeData,
      };
    });
    setNodes(nextNodes);
    emitDsl(nextNodes, edges);
  }, [edges, emitDsl, flowPosFromEvent, nodes, setNodes, syncDsl]);

  const onNodeClick = useCallback((_: unknown, node: Node) => setSelectedNodeId(node.id), []);
  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  const selectedNode = nodes.find(n => n.id === selectedNodeId) as Node<StepNodeData> | undefined;

  const handleNodeUpdate = useCallback(
    (data: StepNodeData) => {
      const nextNodes = nodes.map(n => n.id === selectedNodeId ? { ...n, data } : n) as Node<StepNodeData>[];
      setNodes(nextNodes);
      emitDsl(nextNodes, edges);
    },
    [edges, emitDsl, nodes, selectedNodeId, setNodes],
  );

  const handleReorderBody = useCallback(
    (order: { body?: string[]; then?: string[]; else?: string[] }) => {
      if (!selectedNodeId) return;
      const newSpec: DslSpec = {
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
      };
      onChange(newSpec);
    },
    [selectedNodeId, onChange],
  );

  const childNodes = useMemo<Record<string, BodyChildInfo>>(() => {
    const m: Record<string, BodyChildInfo> = {};
    for (const n of nodes) {
      m[n.id] = { stepId: n.id, label: n.data.label, stepType: n.data.stepType };
    }
    return m;
  }, [nodes]);

  const availableChildIds = useMemo(
    () => (nodes as Node<StepNodeData>[])
      .filter(n => n.id !== selectedNodeId && !n.parentId)
      .map(n => n.id),
    [nodes, selectedNodeId],
  );

  const handleNodeDelete = useCallback(() => {
    if (!selectedNodeId) return;
    const nextNodes = nodes.filter(n => n.id !== selectedNodeId) as Node<StepNodeData>[];
    const nextEdges = edges.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(null);
    emitDsl(nextNodes, nextEdges);
  }, [edges, emitDsl, nodes, selectedNodeId, setNodes, setEdges]);

  const renderedNodes = useMemo(
    () => applyDropTargetFlag(nodes as Node<StepNodeData>[], dropTargetId),
    [nodes, dropTargetId],
  );

  const { showRefs, refEdgeCount, displayEdges, toggle: toggleRefs } = useRefEdgeToggle(edges);

  return (
    <div className="flex rounded-xl border border-border/60 overflow-hidden" style={{ height }}>
      <NodePalette />
      <div ref={reactFlowWrapper} className="flex-1 relative">
        <ReactFlow
          nodes={renderedNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
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
      </div>
      {selectedNode && (
        <PropertiesPanel
          data={selectedNode.data}
          allStepIds={nodes.map(n => n.id)}
          onUpdate={handleNodeUpdate}
          onDelete={handleNodeDelete}
          onClose={() => setSelectedNodeId(null)}
          childNodes={childNodes}
          availableChildIds={availableChildIds}
          onReorderBody={handleReorderBody}
        />
      )}
    </div>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
