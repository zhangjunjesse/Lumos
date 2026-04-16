/**
 * Graph-traversal helpers backing the debug-cache module:
 *
 *   - upstream closure (what must run before the target step)
 *   - transitive downstream (what must be invalidated when a step changes)
 *
 * Containers (if-else / for-each / while) are treated as a single unit:
 * their body subtrees move together during both upstream and downstream
 * computation. Extracted here so debug-cache.ts stays under the 300-line rule.
 */
import {
  buildParentMap,
  getBodyIds,
  getElseIds,
  getLoopBodyIds,
  getThenIds,
  isContainer,
  type LayoutStep,
} from './dsl-graph-layout';
import type { AnyWorkflowDSL } from './types';

function toLayoutSteps(dsl: AnyWorkflowDSL): LayoutStep[] {
  return dsl.steps.map(s => ({
    id: s.id,
    type: s.type,
    dependsOn: s.dependsOn,
    input: s.input,
  }));
}

/** True if step B appears strictly before step A within the same body list. */
function priorSiblings(targetId: string, siblings: string[]): string[] {
  const i = siblings.indexOf(targetId);
  if (i <= 0) return [];
  return siblings.slice(0, i);
}

/** Find the body list containing stepId (then/else/loop-body, or top-level). */
function findBodyList(stepId: string, steps: LayoutStep[]): string[] | null {
  for (const s of steps) {
    if (!isContainer(s)) continue;
    if (s.type === 'if-else') {
      const thens = getThenIds(s);
      const elses = getElseIds(s);
      if (thens.includes(stepId)) return thens;
      if (elses.includes(stepId)) return elses;
    } else if (getLoopBodyIds(s).includes(stepId)) {
      return getLoopBodyIds(s);
    }
  }
  // Top-level siblings (in DSL insertion order, filtered to the top layer).
  const ownedIds = new Set<string>();
  for (const s of steps) if (isContainer(s)) for (const id of getBodyIds(s)) ownedIds.add(id);
  const topLevel = steps.filter(s => !ownedIds.has(s.id)).map(s => s.id);
  if (topLevel.includes(stepId)) return topLevel;
  return null;
}

/** Collect all descendants of a container (body subtree, recursive). */
function collectDescendants(
  containerId: string,
  stepMap: Map<string, LayoutStep>,
): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [containerId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const s = stepMap.get(id);
    if (!s || !isContainer(s)) continue;
    for (const child of getBodyIds(s)) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

/**
 * Upstream closure of `targetId`:
 *
 *   - dependsOn chain (transitive)
 *   - prior siblings within the same body list (execution-order dependency)
 *   - recurse into all ancestors (container chain): the container itself is
 *     upstream, as are ITS prior siblings / deps / etc.
 *
 * Excludes `targetId` itself. Never includes descendants of the target.
 */
export function computeUpstreamClosure(
  targetId: string,
  dsl: AnyWorkflowDSL,
): Set<string> {
  const layout = toLayoutSteps(dsl);
  const stepMap = new Map(layout.map(s => [s.id, s]));
  const parentMap = buildParentMap(layout);

  const upstream = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [targetId];

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const step = stepMap.get(id);
    if (!step) continue;

    // 1. dependsOn (transitive)
    for (const dep of step.dependsOn ?? []) {
      if (!stepMap.has(dep)) continue;
      if (!upstream.has(dep) && dep !== targetId) upstream.add(dep);
      stack.push(dep);
    }

    // 2. prior siblings in the same body list
    const body = findBodyList(id, layout);
    if (body) {
      for (const sid of priorSiblings(id, body)) {
        if (sid === targetId) continue;
        if (!upstream.has(sid)) upstream.add(sid);
        stack.push(sid);
      }
    }

    // 3. ancestor container chain: every container we're nested in is upstream
    //    of us, and its own upstream (deps / prior siblings at its level) must
    //    also be visited. Containers themselves don't count as descendants of
    //    the target.
    const parent = parentMap.get(id);
    if (parent && parent !== targetId) {
      if (!upstream.has(parent)) upstream.add(parent);
      stack.push(parent);
    }
  }

  return upstream;
}

/**
 * Transitive downstream of `stepId` — steps that structurally depend on it.
 *
 * Containers are treated as a unit: when `stepId` is a container, its entire
 * body subtree is ALSO considered downstream (must be invalidated together).
 * Inverse is not symmetric: a body step is downstream of its container only
 * if you pass the container in.
 */
export function computeTransitiveDownstream(
  stepId: string,
  dsl: AnyWorkflowDSL,
): string[] {
  const layout = toLayoutSteps(dsl);
  const stepMap = new Map(layout.map(s => [s.id, s]));
  const out = new Set<string>();
  const stack: string[] = [stepId];

  while (stack.length > 0) {
    const id = stack.pop()!;
    // Include container's body subtree
    if (stepMap.get(id) && isContainer(stepMap.get(id)!)) {
      for (const d of collectDescendants(id, stepMap)) {
        if (d !== stepId && !out.has(d)) {
          out.add(d);
          stack.push(d);
        }
      }
    }
    // Siblings that come after `id` in the same body list (execution-order downstream)
    const body = findBodyList(id, layout);
    if (body) {
      const i = body.indexOf(id);
      if (i >= 0) {
        for (const sid of body.slice(i + 1)) {
          if (sid !== stepId && !out.has(sid)) {
            out.add(sid);
            stack.push(sid);
          }
        }
      }
    }
    // Explicit dependsOn reverse edges
    for (const s of layout) {
      if ((s.dependsOn ?? []).includes(id) && !out.has(s.id) && s.id !== stepId) {
        out.add(s.id);
        stack.push(s.id);
      }
    }
  }

  return Array.from(out);
}
