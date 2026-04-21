/**
 * V3 图的基础访问 / 链上行走 helper。
 * 所有调用方(canvas / body-manager / container helpers 等)共用。
 */
import type { EdgeKind, WorkflowEdge } from './types-v3';

// ── 基础访问 ────────────────────────────────────────────────────────────────

export function findOutgoingEdge(
  edges: readonly WorkflowEdge[],
  from: string,
  kind: EdgeKind,
): WorkflowEdge | undefined {
  return edges.find((e) => e.from === from && e.kind === kind);
}

export function outgoingEdges(
  edges: readonly WorkflowEdge[],
  from: string,
): WorkflowEdge[] {
  return edges.filter((e) => e.from === from);
}

export function incomingEdges(
  edges: readonly WorkflowEdge[],
  to: string,
): WorkflowEdge[] {
  return edges.filter((e) => e.to === to);
}

export function countIncoming(edges: readonly WorkflowEdge[], to: string): number {
  let n = 0;
  for (const e of edges) if (e.to === to) n += 1;
  return n;
}

export function countOutgoingByKind(
  edges: readonly WorkflowEdge[],
  from: string,
  kind: EdgeKind,
): number {
  let n = 0;
  for (const e of edges) if (e.from === from && e.kind === kind) n += 1;
  return n;
}

// ── 链上行走 ────────────────────────────────────────────────────────────────

export function walkNextChainUntil(
  startId: string,
  edges: readonly WorkflowEdge[],
  stop: (id: string) => boolean,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = startId;
  while (cursor && !seen.has(cursor)) {
    if (stop(cursor)) break;
    seen.add(cursor);
    chain.push(cursor);
    cursor = findOutgoingEdge(edges, cursor, 'next')?.to;
  }
  return chain;
}

export function collectNextReachable(
  start: string,
  edges: readonly WorkflowEdge[],
): Set<string> {
  const out = new Set<string>();
  const queue: string[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const e of edges) {
      if (e.from === cur && e.kind === 'next') queue.push(e.to);
    }
  }
  return out;
}
