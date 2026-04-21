import type { Node, Edge } from '@xyflow/react';
import { buildVisualEdges } from './dsl-graph-edges';
import { computeLayout, type NodePos } from './dsl-graph-layout';
import {
  computeContainerOwnership,
  countIncoming,
  countOutgoingByKind,
  extractBodyChain,
  extractIfElseBranches,
  isContainerNodeType,
  removeNodeFromDsl as removeNodeFromDslGraph,
  rewriteContainerChain,
} from './dsl-graph-v3-helpers';
import type {
  WorkflowDSLV3,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from './types-v3';

// ── Canvas node data shape (V3-native) ─────────────────────────────────────

/**
 * React Flow 节点 `data`。所有数据都能从 WorkflowNode + edges 派生,
 * 这里只暴露 UI 渲染和属性面板需要的字段。
 *
 * 注意: 不再有 `dependsOn`。前驱关系通过边表达;UI 需要"谁先运行"的视觉提示时,
 * 通过 `NodeOverlayProvider` 注入;不塞进节点 data。
 */
export interface StepNodeData {
  stepId: string;
  stepType: WorkflowNodeType;
  label: string;
  /** 完整节点对象,属性面板直接改这里. */
  node: WorkflowNode;
  /** 归属的控制流容器 id. 顶层节点为 undefined. */
  containerId?: string;
  /** if-else then 分支节点数. */
  thenCount?: number;
  /** if-else else 分支节点数. */
  elseCount?: number;
  /** for-each / while body 节点数. */
  bodyCount?: number;
  /** parallel 分支数 (= 当前节点 next 出边总数). */
  branchCount?: number;
  /** join 汇合入边数. */
  inbound?: number;
  [key: string]: unknown;
}

// ── Label helpers ──────────────────────────────────────────────────────────

function nodeLabel(node: WorkflowNode, names: Record<string, string>): string {
  if (node.type === 'agent') {
    const preset = (node.input as { preset?: unknown }).preset;
    return typeof preset === 'string' ? (names[preset] || preset) : node.id;
  }
  if (node.type === 'while') {
    const mode = (node.input as { mode?: unknown }).mode;
    return mode === 'do-while' ? 'DO-WHILE' : 'WHILE';
  }
  const m: Record<string, string> = {
    'if-else': 'IF / ELSE',
    'for-each': 'FOR EACH',
    wait: '等待',
    notification: '通知',
    parallel: 'PARALLEL',
    join: 'JOIN',
    approval: '人工审批',
  };
  if (m[node.type]) return m[node.type];
  if (node.type === 'capability') {
    const c = (node.input as { capabilityId?: unknown }).capabilityId;
    return typeof c === 'string' ? c : '能力';
  }
  return node.id;
}

export function stepTypeToNodeType(t: string): string {
  const DEDICATED = new Set([
    'agent', 'if-else', 'for-each', 'while', 'wait', 'notification', 'capability',
    'parallel', 'join', 'approval',
  ]);
  return DEDICATED.has(t) ? t : 'agent';
}

// ── Position resolution ────────────────────────────────────────────────────

function positionFromMetadata(node: WorkflowNode): NodePos | undefined {
  const pos = node.metadata?.position;
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return undefined;
  return { x: pos.x, y: pos.y };
}

function resolvePositions(
  nodes: readonly WorkflowNode[],
  visualEdges: Edge[],
): Map<string, NodePos> {
  const hasContainer = nodes.some((n) => isContainerNodeType(n.type));
  const allHavePos = nodes.every((n) => positionFromMetadata(n));
  if (!hasContainer && allHavePos) {
    const m = new Map<string, NodePos>();
    for (const n of nodes) m.set(n.id, positionFromMetadata(n)!);
    return m;
  }
  return computeLayout(nodes, visualEdges);
}

// ── DSL → Graph ────────────────────────────────────────────────────────────

export function dslToGraph(
  dsl: WorkflowDSLV3,
  presetNames: Record<string, string> = {},
): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  const ownership = computeContainerOwnership(dsl.nodes, dsl.edges);
  const edges = buildVisualEdges(dsl);
  const positions = resolvePositions(dsl.nodes, edges);

  const nodes = dsl.nodes.map<Node<StepNodeData>>((node) => {
    const data = buildStepNodeData(node, dsl.edges, ownership, presetNames);
    return {
      id: node.id,
      type: stepTypeToNodeType(node.type),
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data,
    };
  });

  return { nodes, edges };
}

function buildStepNodeData(
  node: WorkflowNode,
  edges: readonly WorkflowEdge[],
  ownership: ReturnType<typeof computeContainerOwnership>,
  presetNames: Record<string, string>,
): StepNodeData {
  const containerId = ownership.parentByChild.get(node.id);
  const base: StepNodeData = {
    stepId: node.id,
    stepType: node.type,
    label: nodeLabel(node, presetNames),
    node,
    ...(containerId ? { containerId } : {}),
  };

  if (node.type === 'if-else') {
    const { thenChain, elseChain } = extractIfElseBranches(node.id, edges);
    base.thenCount = thenChain.length;
    base.elseCount = elseChain.length;
  } else if (node.type === 'for-each' || node.type === 'while') {
    base.bodyCount = extractBodyChain(node.id, edges).length;
  } else if (node.type === 'parallel') {
    base.branchCount = countOutgoingByKind(edges, node.id, 'next');
  } else if (node.type === 'join') {
    base.inbound = countIncoming(edges, node.id);
  }

  return base;
}

// ── Graph → DSL ────────────────────────────────────────────────────────────

/**
 * 把画布当前节点 + 现有 DSL 合并回一份新的 V3 DSL。
 *
 * - 节点: 以画布节点为准(覆盖 position metadata),node.input/policy/onError 等从
 *   StepNodeData.node 读写。
 * - 边: 以 `baseDsl.edges` 为准 —— BodyManager / onConnect / delete 会直接改 DSL
 *   并通过 onChange 回传;graphToDsl 不尝试从 React Flow 边反解。
 */
export function graphToDsl(
  nodes: Node<StepNodeData>[],
  _visualEdges: Edge[],
  baseDsl: WorkflowDSLV3,
): WorkflowDSLV3 {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const dataById = new Map<string, StepNodeData>();
  for (const n of nodes) dataById.set(n.id, n.data);

  const nextNodes: WorkflowNode[] = nodes.map((rfNode) => {
    const data = rfNode.data;
    const fromCanvas = data.node;
    const position = { x: rfNode.position.x, y: rfNode.position.y };
    const metadata = { ...(fromCanvas.metadata ?? {}), position };
    return { ...fromCanvas, metadata } as WorkflowNode;
  });

  const edges = baseDsl.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );

  const sanitized = sanitizeInputs(nextNodes, nodeIds);
  return {
    ...baseDsl,
    nodes: sanitized,
    edges,
    // Preserve canvas-derived data in next StepNodeData if consumer uses it
    ...(dataById.size ? {} : {}),
  };
}

function sanitizeInputs(
  nodes: readonly WorkflowNode[],
  nodeIds: ReadonlySet<string>,
): WorkflowNode[] {
  return nodes.map((n) => {
    if ('input' in n && n.input) {
      const nextInput = pruneStaleStepRefs(n.input, nodeIds);
      return { ...n, input: nextInput } as WorkflowNode;
    }
    return n;
  });
}

const STEP_REF_RE = /^steps\.([A-Za-z0-9_-]+)\.output(?:\.(.+))?$/;

function pruneStaleStepRefs(value: unknown, ids: ReadonlySet<string>): unknown {
  if (typeof value === 'string') {
    const m = STEP_REF_RE.exec(value);
    return m && !ids.has(m[1]) ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value.map((e) => pruneStaleStepRefs(e, ids)).filter((e) => e !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const s = pruneStaleStepRefs(v, ids);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

// ── 便捷移除入口 (给 step editor / canvas 调用) ─────────────────────────────

export function removeNodeFromDsl(dsl: WorkflowDSLV3, nodeId: string): WorkflowDSLV3 {
  const target = dsl.nodes.find((n) => n.id === nodeId);
  let working = dsl;
  if (target && isContainerNodeType(target.type)) {
    const branches = ['body', 'then', 'else'] as const;
    for (const kind of branches) {
      if (countOutgoingByKind(working.edges, nodeId, kind) === 0) continue;
      working = rewriteContainerChain(nodeId, kind, [], working);
    }
  }
  working = removeNodeFromDslGraph(working, nodeId);
  const remainingIds = new Set(working.nodes.map((x) => x.id));
  return {
    ...working,
    nodes: working.nodes.map((n) => {
      if ('input' in n && n.input) {
        const pruned = pruneStaleStepRefs(n.input, remainingIds);
        return { ...n, input: pruned as WorkflowNode['input'] } as WorkflowNode;
      }
      return n;
    }),
  };
}
