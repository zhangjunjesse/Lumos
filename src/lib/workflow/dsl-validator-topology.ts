import {
  findEntryNodes,
  findIllegalCycles,
  reachableFrom,
  type GraphIndex,
} from './dsl-validator-graph';
import { PARALLEL_MAX_BRANCHES } from './types-v3';
import type { IssueEmit } from './dsl-validator-types';

// ── 6. Entry: 恰好 1 个无正常入边的节点 ────────────────────────────────────

export function checkEntry(index: GraphIndex, emit: IssueEmit): void {
  const entries = findEntryNodes(index);
  if (entries.length === 0) {
    emit({
      severity: 'error', code: 'E_NO_ENTRY', jsonPath: 'nodes',
      message: 'workflow has no entry node (every node has incoming edges)',
    });
  } else if (entries.length > 1) {
    emit({
      severity: 'error', code: 'E_MULTI_ENTRY', jsonPath: 'nodes',
      message: `workflow has ${entries.length} entry nodes: ${entries.map((n) => n.id).join(', ')}; expected exactly 1`,
      hint: 'Connect extra entries via explicit edges.',
    });
  }
}

// ── 7. 不可达节点 ──────────────────────────────────────────────────────────

export function checkReachability(index: GraphIndex, emit: IssueEmit): void {
  const entries = findEntryNodes(index).map((n) => n.id);
  if (entries.length === 0) return;
  const reached = reachableFrom(index, entries);
  for (const id of index.nodeById.keys()) {
    if (!reached.has(id)) {
      emit({
        severity: 'error', code: 'E_UNREACHABLE', nodeId: id,
        jsonPath: `nodes[${id}]`, message: `node "${id}" is unreachable from entry`,
      });
    }
  }
}

// ── 8. 非法环 (只允许通过 loop-head 的 body 边形成) ────────────────────────

export function checkIllegalCycles(index: GraphIndex, emit: IssueEmit): void {
  const cycles = findIllegalCycles(index);
  for (const cycle of cycles) {
    emit({
      severity: 'error', code: 'E_ILLEGAL_CYCLE',
      jsonPath: `edges[cycle:${cycle.join('->')}]`,
      message: `illegal cycle detected: ${cycle.join(' -> ')}`,
      hint: 'Only while/for-each nodes may create loops via their body edge; refactor to use a loop node.',
    });
  }
}

// ── 9. parallel ↔ join 配对 (stack-based BFS) ─────────────────────────────

export function checkParallelJoin(index: GraphIndex, emit: IssueEmit): void {
  for (const node of index.nodeById.values()) {
    if (node.type !== 'parallel') continue;
    const branches = index.outByKind.get(node.id)?.get('next') ?? [];
    const reachedJoins = new Set<string>();
    for (const br of branches) {
      const j = findEnclosingJoin(index, br.to);
      if (!j) {
        emit({
          severity: 'error', code: 'E_PARALLEL_BRANCH_NO_JOIN', nodeId: node.id,
          jsonPath: `edges[from=${node.id},branchIndex=${br.branchIndex ?? '?'}]`,
          message: `parallel "${node.id}" branch to "${br.to}" does not reach a join node`,
        });
      } else {
        reachedJoins.add(j);
      }
    }
    if (reachedJoins.size > 1) {
      emit({
        severity: 'error', code: 'E_PARALLEL_JOIN_MISMATCH', nodeId: node.id,
        jsonPath: `nodes[${node.id}]`,
        message: `parallel "${node.id}" branches converge to multiple joins: ${[...reachedJoins].join(', ')}; expected exactly 1`,
      });
    } else if (reachedJoins.size === 1) {
      const joinId = [...reachedJoins][0];
      const joinIn = (index.inEdges.get(joinId) ?? []).filter((e) => e.kind === 'next').length;
      if (joinIn !== branches.length) {
        emit({
          severity: 'error', code: 'E_JOIN_IN_MISMATCH', nodeId: joinId,
          jsonPath: `nodes[${joinId}].inEdges`,
          message: `join "${joinId}" has ${joinIn} incoming next edges, parallel "${node.id}" has ${branches.length} branches`,
          expected: branches.length, actual: joinIn,
        });
      }
    }
  }
}

/** BFS 沿 next/then/else/body 前向, 找最近的 join (含 parallel 栈深度匹配)。 */
function findEnclosingJoin(index: GraphIndex, startId: string): string | undefined {
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(`${id}@${depth}`)) continue;
    visited.add(`${id}@${depth}`);
    const node = index.nodeById.get(id);
    if (!node) continue;
    if (node.type === 'join' && depth === 0) return id;
    const nextDepth = node.type === 'parallel' ? depth + 1 : node.type === 'join' ? depth - 1 : depth;
    if (nextDepth < 0) continue;
    for (const e of index.outEdges.get(id) ?? []) {
      if (e.kind === 'on-error') continue;
      queue.push({ id: e.to, depth: nextDepth });
    }
  }
  return undefined;
}

// ── 10. parallel 分支数 ≤ PARALLEL_MAX_BRANCHES ─────────────────────────────

export function checkParallelBranchLimit(index: GraphIndex, emit: IssueEmit): void {
  for (const node of index.nodeById.values()) {
    if (node.type !== 'parallel') continue;
    const count = (index.outByKind.get(node.id)?.get('next') ?? []).length;
    if (count > PARALLEL_MAX_BRANCHES) {
      emit({
        severity: 'error', code: 'E_MAX_PARALLEL_BRANCHES', nodeId: node.id,
        jsonPath: `nodes[${node.id}].outEdges.next`,
        message: `parallel "${node.id}" has ${count} branches, max allowed is ${PARALLEL_MAX_BRANCHES}`,
        expected: PARALLEL_MAX_BRANCHES, actual: count,
      });
    }
  }
}
