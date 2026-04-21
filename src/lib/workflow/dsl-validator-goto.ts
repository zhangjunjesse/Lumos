import { computeTopoPredecessors, type GraphIndex } from './dsl-validator-graph';
import type { WorkflowNode, WorkflowNodeType } from './types-v3';
import type { IssueEmit } from './dsl-validator-types';
import { computeBodyScope } from './dsl-validator-references';

// ── 13. onError.action='goto' 目标不得跨 while/for-each 边界 ────────────────

export function checkGotoAcrossLoop(index: GraphIndex, emit: IssueEmit): void {
  const loopScopes = collectLoopScopes(index);
  for (const node of index.nodeById.values()) {
    const oe = node.onError;
    if (oe?.action !== 'goto' || !oe.target) continue;
    for (const [loopId, scope] of loopScopes) {
      const sourceInside = scope.has(node.id);
      const targetInside = scope.has(oe.target);
      if (sourceInside !== targetInside) {
        emit({
          severity: 'error', code: 'E_GOTO_CROSS_LOOP', nodeId: node.id,
          jsonPath: `nodes[${node.id}].onError.target`,
          message: `onError.goto "${oe.target}" crosses loop "${loopId}" boundary`,
          hint: 'goto target must be within the same loop body (or both outside).',
        });
      }
    }
  }
}

// ── 14. onError.goto 运行时支持检查 ────────────────────────────────────────

const GOTO_RUNTIME_SOURCE_TYPES: ReadonlySet<WorkflowNodeType> = new Set([
  'agent', 'notification', 'capability', 'wait', 'join', 'approval',
]);

const GOTO_RUNTIME_TARGET_TYPES: ReadonlySet<WorkflowNodeType> = new Set([
  'agent', 'notification', 'capability', 'wait', 'join', 'approval',
]);

export function checkGotoRuntimeSupport(index: GraphIndex, emit: IssueEmit): void {
  const topoPreds = computeTopoPredecessors(index);
  const ownedIds = computeOwnedNodeIds(index);
  const loopScopes = collectLoopScopes(index);

  for (const node of index.nodeById.values()) {
    const oe = node.onError;
    if (oe?.action !== 'goto' || !oe.target) continue;

    validateGotoSourceType(node, emit);
    const targetNode = index.nodeById.get(oe.target);
    if (!targetNode) continue;

    validateGotoTargetType(node, oe.target, targetNode.type, emit);
    validateGotoTargetTopLevel(node, oe.target, ownedIds, emit);
    validateGotoNotInLoop(node, oe.target, loopScopes, emit);
    validateGotoForwardSuccessor(node, oe.target, topoPreds, emit);
  }
}

function validateGotoSourceType(node: WorkflowNode, emit: IssueEmit): void {
  if (GOTO_RUNTIME_SOURCE_TYPES.has(node.type)) return;
  emit({
    severity: 'error',
    code: 'E_GOTO_SOURCE_UNSUPPORTED',
    nodeId: node.id,
    jsonPath: `nodes[${node.id}].onError`,
    message: `onError.goto is only supported on leaf nodes; got source type "${node.type}"`,
    hint: 'Move goto handling onto a leaf node such as agent/notification/capability/wait/join/approval.',
  });
}

function validateGotoTargetType(
  node: WorkflowNode, target: string, targetType: WorkflowNodeType, emit: IssueEmit,
): void {
  if (GOTO_RUNTIME_TARGET_TYPES.has(targetType)) return;
  emit({
    severity: 'error',
    code: 'E_GOTO_TARGET_UNSUPPORTED',
    nodeId: node.id,
    jsonPath: `nodes[${node.id}].onError.target`,
    message: `goto target "${target}" must be a leaf node; got "${targetType}"`,
    hint: 'Target a top-level leaf node such as a cleanup/notification/wait step.',
  });
}

function validateGotoTargetTopLevel(
  node: WorkflowNode, target: string, owned: Set<string>, emit: IssueEmit,
): void {
  if (!owned.has(target)) return;
  emit({
    severity: 'error',
    code: 'E_GOTO_TARGET_NOT_TOP_LEVEL',
    nodeId: node.id,
    jsonPath: `nodes[${node.id}].onError.target`,
    message: `goto target "${target}" must be a top-level node, not a branch/body-owned node`,
    hint: 'Point goto to a top-level cleanup node after the current branch/container.',
  });
}

function validateGotoNotInLoop(
  node: WorkflowNode, target: string, loopScopes: Map<string, Set<string>>, emit: IssueEmit,
): void {
  if (!isInsideAnyLoop(loopScopes, node.id) && !isInsideAnyLoop(loopScopes, target)) return;
  emit({
    severity: 'error',
    code: 'E_GOTO_LOOP_RUNTIME_UNSUPPORTED',
    nodeId: node.id,
    jsonPath: `nodes[${node.id}].onError.target`,
    message: `goto between "${node.id}" and "${target}" is not supported from or into loop scope`,
    hint: 'Move cleanup target outside the loop and use continue/fail inside loop bodies.',
  });
}

function validateGotoForwardSuccessor(
  node: WorkflowNode, target: string, topoPreds: Map<string, Set<string>>, emit: IssueEmit,
): void {
  const targetPreds = topoPreds.get(target);
  if (!targetPreds || targetPreds.has(node.id)) return;
  emit({
    severity: 'error',
    code: 'E_GOTO_TARGET_NOT_FORWARD',
    nodeId: node.id,
    jsonPath: `nodes[${node.id}].onError.target`,
    message: `goto target "${target}" is not a normal forward successor of "${node.id}"`,
    hint: 'Only jump forward to an existing cleanup/fallback step in the normal control flow.',
  });
}

function computeOwnedNodeIds(index: GraphIndex): Set<string> {
  const owned = new Set<string>();
  for (const edges of index.inEdges.values()) {
    for (const edge of edges) {
      if (edge.kind === 'then' || edge.kind === 'else' || edge.kind === 'body') {
        owned.add(edge.to);
      }
    }
  }
  return owned;
}

function collectLoopScopes(index: GraphIndex): Map<string, Set<string>> {
  const scopes = new Map<string, Set<string>>();
  for (const loop of index.nodeById.values()) {
    if (loop.type !== 'while' && loop.type !== 'for-each') continue;
    const bodyStart = (index.outByKind.get(loop.id)?.get('body') ?? [])[0]?.to;
    if (bodyStart) scopes.set(loop.id, computeBodyScope(index, loop.id, bodyStart));
  }
  return scopes;
}

function isInsideAnyLoop(loopScopes: Map<string, Set<string>>, nodeId: string): boolean {
  for (const scope of loopScopes.values()) {
    if (scope.has(nodeId)) return true;
  }
  return false;
}
