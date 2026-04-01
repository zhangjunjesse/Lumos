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
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { NODE_TYPES } from './nodes';
import { NodePalette } from './node-palette';
import { PropertiesPanel } from './properties-panel';
import {
  dslToGraph,
  graphToDsl,
  type StepNodeData,
} from '@/lib/workflow/dsl-graph-converter';

interface DslStep {
  id: string;
  type: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
  metadata?: { position?: { x: number; y: number } };
}

interface DslSpec {
  version: string;
  name: string;
  description?: string;
  steps: DslStep[];
}

interface WorkflowCanvasProps {
  dsl: DslSpec;
  presetNames?: Record<string, string>;
  onChange: (dsl: DslSpec) => void;
  height?: number;
}

function genId(type: string): string {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

function defaultInputForType(type: string): Record<string, unknown> {
  switch (type) {
    case 'agent': return { prompt: '', role: 'worker' };
    case 'if-else': return { condition: { op: 'exists', ref: 'input.flag' }, then: [] };
    case 'for-each': return { collection: 'input.items', itemVar: 'item', body: [] };
    case 'while': return { condition: { op: 'exists', ref: 'input.hasMore' }, body: [], maxIterations: 20 };
    case 'wait': return { durationMs: 5000 };
    default: return {};
  }
}

function WorkflowCanvasInner({ dsl, presetNames = {}, onChange, height = 480 }: WorkflowCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { getNodes, getEdges } = useReactFlow();
  const dslRef = useRef(dsl);
  // eslint-disable-next-line react-hooks/refs
  dslRef.current = dsl;

  const initial = useMemo(() => dslToGraph(dsl, presetNames), [dsl, presetNames]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  // Sync xyflow state when DSL prop changes externally (e.g. JSON editor)
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

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(eds => addEdge({ ...params, id: `dep-${params.source}-${params.target}` }, eds));
      // syncDsl after state settles
      setTimeout(syncDsl, 0);
    },
    [setEdges, syncDsl],
  );

  const onNodeDragStop = useCallback(() => syncDsl(), [syncDsl]);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/workflow-node-type');
      if (!type || !reactFlowWrapper.current) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = { x: event.clientX - bounds.left - 100, y: event.clientY - bounds.top - 40 };
      const stepId = genId(type);

      const newNode: Node<StepNodeData> = {
        id: stepId,
        type: type === 'agent' ? 'agent' : type,
        position,
        data: {
          stepId, stepType: type,
          label: type === 'agent' ? stepId : type.toUpperCase(),
          input: defaultInputForType(type), dependsOn: [],
        },
      };

      setNodes(nds => [...nds, newNode]);
      setTimeout(syncDsl, 0);
    },
    [setNodes, syncDsl],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onNodeClick = useCallback((_: unknown, node: Node) => setSelectedNodeId(node.id), []);
  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  const selectedNode = nodes.find(n => n.id === selectedNodeId) as Node<StepNodeData> | undefined;

  const handleNodeUpdate = useCallback(
    (data: StepNodeData) => {
      setNodes(nds => nds.map(n => n.id === selectedNodeId ? { ...n, data } : n));
      setTimeout(syncDsl, 0);
    },
    [selectedNodeId, setNodes, syncDsl],
  );

  const handleNodeDelete = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes(nds => nds.filter(n => n.id !== selectedNodeId));
    setEdges(eds => eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
    setTimeout(syncDsl, 0);
  }, [selectedNodeId, setNodes, setEdges, syncDsl]);

  return (
    <div className="flex rounded-xl border border-border/60 overflow-hidden" style={{ height }}>
      <NodePalette />
      <div ref={reactFlowWrapper} className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onDrop={onDrop}
          onDragOver={onDragOver}
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
        </ReactFlow>
      </div>
      {selectedNode && (
        <PropertiesPanel
          data={selectedNode.data}
          allStepIds={nodes.map(n => n.id)}
          onUpdate={handleNodeUpdate}
          onDelete={handleNodeDelete}
          onClose={() => setSelectedNodeId(null)}
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

