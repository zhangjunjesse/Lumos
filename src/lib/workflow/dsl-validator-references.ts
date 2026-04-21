import { computeTopoPredecessors, type GraphIndex } from './dsl-validator-graph';
import type { IssueEmit } from './dsl-validator-types';

// ── 11. `{{ steps.X.output.* }}` X 必须是拓扑前驱 ───────────────────────────

const REF_PATTERN = /\{\{\s*steps\.([A-Za-z][A-Za-z0-9_-]*)\.output[^}]*\}\}/g;
const DIRECT_REF_PATTERN = /^steps\.([A-Za-z][A-Za-z0-9_-]*)\.output/;

function extractStepRefsFromValue(value: unknown): string[] {
  if (typeof value === 'string') {
    const ids: string[] = [];
    for (const m of value.matchAll(REF_PATTERN)) ids.push(m[1]);
    const direct = DIRECT_REF_PATTERN.exec(value);
    if (direct) ids.push(direct[1]);
    return ids;
  }
  if (Array.isArray(value)) return value.flatMap(extractStepRefsFromValue);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(extractStepRefsFromValue);
  }
  return [];
}

export function checkReferencesTopoPredecessor(index: GraphIndex, emit: IssueEmit): void {
  const preds = computeTopoPredecessors(index);
  // while 循环的 input (condition) 允许引用 body 内节点: 运行时 do-while 先跑 body
  // 再评估 condition; 普通 while 在 iter N>0 时 body 已完成。均为合法回边语义。
  // for-each 的 items 必须 body 前已知, 不放开。
  const loopBodyAllowance = new Map<string, Set<string>>();
  for (const node of index.nodeById.values()) {
    if (node.type !== 'while') continue;
    const bodyStart = (index.outByKind.get(node.id)?.get('body') ?? [])[0]?.to;
    if (!bodyStart) continue;
    loopBodyAllowance.set(node.id, computeBodyScope(index, node.id, bodyStart));
  }

  for (const node of index.nodeById.values()) {
    const input = (node as { input?: unknown }).input;
    const refs = extractStepRefsFromValue(input);
    const allowed = preds.get(node.id) ?? new Set();
    const extra = loopBodyAllowance.get(node.id);
    for (const ref of refs) {
      if (ref === node.id) {
        emit({
          severity: 'error', code: 'E_SELF_REF', nodeId: node.id,
          jsonPath: `nodes[${node.id}].input`,
          message: `node "${node.id}" references its own output`,
        });
        continue;
      }
      if (!index.nodeById.has(ref)) {
        emit({
          severity: 'error', code: 'E_UNKNOWN_REF', nodeId: node.id,
          jsonPath: `nodes[${node.id}].input`,
          message: `reference "steps.${ref}.output.*" targets unknown node`,
        });
        continue;
      }
      if (!allowed.has(ref) && !extra?.has(ref)) {
        emit({
          severity: 'error', code: 'E_REF_TOPO_INVALID', nodeId: node.id,
          jsonPath: `nodes[${node.id}].input`,
          message: `reference "steps.${ref}.output.*" is not a topological predecessor of "${node.id}" (would read before write)`,
          hint: 'Add an edge path from the referenced node to this node, or move the reference.',
        });
      }
    }
  }
}

// ── 12. for-each itemVar 不得在循环体外引用 ──────────────────────────────

export function checkLoopVarScope(index: GraphIndex, emit: IssueEmit): void {
  const forEachNodes = [...index.nodeById.values()].filter((n) => n.type === 'for-each');
  for (const loop of forEachNodes) {
    const itemVar = (loop as { input: { itemVar: string } }).input.itemVar;
    const pattern = new RegExp(`\\b${itemVar}\\b`);
    const bodyStart = (index.outByKind.get(loop.id)?.get('body') ?? [])[0]?.to;
    if (!bodyStart) continue;
    const bodyScope = computeBodyScope(index, loop.id, bodyStart);
    for (const node of index.nodeById.values()) {
      if (bodyScope.has(node.id) || node.id === loop.id) continue;
      const inputStr = JSON.stringify((node as { input?: unknown }).input ?? '');
      if (pattern.test(inputStr)) {
        emit({
          severity: 'error', code: 'E_LOOP_VAR_LEAK', nodeId: node.id,
          jsonPath: `nodes[${node.id}].input`,
          message: `node "${node.id}" references loop var "${itemVar}" outside for-each "${loop.id}" body`,
        });
      }
    }
  }
}

/** 循环体作用域: 从 body 起点可达, 到 loop next 边或 loop 头停止。 */
export function computeBodyScope(index: GraphIndex, loopId: string, bodyStart: string): Set<string> {
  const nextOut = (index.outByKind.get(loopId)?.get('next') ?? [])[0]?.to;
  const scope = new Set<string>();
  const queue = [bodyStart];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (scope.has(id) || id === nextOut || id === loopId) continue;
    scope.add(id);
    for (const e of index.outEdges.get(id) ?? []) {
      if (e.kind === 'on-error') continue;
      queue.push(e.to);
    }
  }
  return scope;
}
