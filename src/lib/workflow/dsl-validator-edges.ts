import type { GraphIndex } from './dsl-validator-graph';
import type { EdgeKind, WorkflowDSLV3, WorkflowEdge, WorkflowNodeType } from './types-v3';
import { NODE_OUT_DEGREE } from './types-v3';
import { edgeLabel, type IssueEmit } from './dsl-validator-types';

// 线性节点可以是工作流终点 (出度 0); 控制流节点必须有出边。
const TERMINAL_OK: ReadonlySet<WorkflowNodeType> = new Set([
  'agent', 'notification', 'capability', 'wait', 'join', 'approval',
]);

// ── 2. 边的端点必须存在 ────────────────────────────────────────────────────

export function checkEdgeEndpoints(dsl: WorkflowDSLV3, emit: IssueEmit): void {
  const ids = new Set(dsl.nodes.map((n) => n.id));
  dsl.edges.forEach((e, idx) => {
    if (!ids.has(e.from)) {
      emit({
        severity: 'error', code: 'E_UNKNOWN_EDGE_NODE', edgeId: edgeLabel(e),
        jsonPath: `edges[${idx}].from`, message: `edge.from "${e.from}" not found`, actual: e.from,
      });
    }
    if (!ids.has(e.to)) {
      emit({
        severity: 'error', code: 'E_UNKNOWN_EDGE_NODE', edgeId: edgeLabel(e),
        jsonPath: `edges[${idx}].to`, message: `edge.to "${e.to}" not found`, actual: e.to,
      });
    }
  });
}

// ── 3. 源节点类型允许的出边 kind ───────────────────────────────────────────

export function checkEdgeKindPerSource(index: GraphIndex, emit: IssueEmit): void {
  for (const [fromId, byKind] of index.outByKind) {
    const node = index.nodeById.get(fromId);
    if (!node) continue;
    const spec = NODE_OUT_DEGREE[node.type];
    for (const kind of byKind.keys()) {
      if (kind === 'on-error') continue;
      const allowed = spec[kind as Exclude<EdgeKind, 'on-error'>];
      if (!allowed) {
        emit({
          severity: 'error', code: 'E_EDGE_KIND_UNSUPPORTED', nodeId: fromId,
          jsonPath: `edges[from=${fromId},kind=${kind}]`,
          message: `node type "${node.type}" does not support outgoing kind="${kind}"`,
          expected: Object.keys(spec), actual: kind,
        });
      }
    }
  }
}

// ── 4. 每个 kind 的出度匹配 spec ───────────────────────────────────────────

export function checkOutDegree(index: GraphIndex, emit: IssueEmit): void {
  for (const node of index.nodeById.values()) {
    const spec = NODE_OUT_DEGREE[node.type];
    const byKind = index.outByKind.get(node.id) ?? new Map();
    const normalOutCount = [...byKind.entries()]
      .filter(([k]) => k !== 'on-error')
      .reduce((sum, [, es]) => sum + (es as WorkflowEdge[]).length, 0);
    // 线性节点出度 0 视为工作流终点, 合法; 控制流节点必须有分支。
    if (normalOutCount === 0 && TERMINAL_OK.has(node.type)) continue;
    for (const [kindStr, rule] of Object.entries(spec)) {
      if (!rule) continue;
      const actual = (byKind.get(kindStr as EdgeKind) ?? []).length;
      const ok = rule.mode === 'exact' ? actual === rule.count : actual >= rule.count;
      if (!ok) {
        emit({
          severity: 'error', code: 'E_OUT_DEGREE_MISMATCH', nodeId: node.id,
          jsonPath: `nodes[${node.id}].outEdges.${kindStr}`,
          message: `node "${node.id}" (type=${node.type}) expects ${rule.mode}=${rule.count} ${kindStr} edges, got ${actual}`,
          expected: `${rule.mode} ${rule.count}`, actual,
        });
      }
    }
  }
}

// ── 5. on-error ≤ 1 + 与 onError.target 一致 ────────────────────────────────

export function checkOnErrorConsistency(index: GraphIndex, emit: IssueEmit): void {
  for (const node of index.nodeById.values()) {
    const onErrEdges = (index.outByKind.get(node.id)?.get('on-error') ?? []) as WorkflowEdge[];
    if (onErrEdges.length > 1) {
      emit({
        severity: 'error', code: 'E_MULTI_ON_ERROR', nodeId: node.id,
        jsonPath: `nodes[${node.id}].outEdges.on-error`,
        message: `node "${node.id}" has ${onErrEdges.length} on-error edges; at most 1 allowed`,
      });
    }
    const onErrCfg = node.onError;
    if (onErrCfg?.action === 'goto') {
      if (onErrEdges.length === 0) {
        emit({
          severity: 'error', code: 'E_ON_ERROR_EDGE_MISSING', nodeId: node.id,
          jsonPath: `nodes[${node.id}].onError`,
          message: `onError.action='goto' requires one outgoing on-error edge`,
          hint: 'Add an edge { from, to: onError.target, kind: "on-error" }.',
        });
      } else if (onErrEdges[0].to !== onErrCfg.target) {
        emit({
          severity: 'error', code: 'E_ON_ERROR_TARGET_MISMATCH', nodeId: node.id,
          jsonPath: `nodes[${node.id}].onError.target`,
          message: `onError.target="${onErrCfg.target}" does not match on-error edge target "${onErrEdges[0].to}"`,
          expected: onErrCfg.target, actual: onErrEdges[0].to,
        });
      }
    }
  }
}
