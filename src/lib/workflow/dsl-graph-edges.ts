import type { Edge } from '@xyflow/react';
import { extractDataRefs } from './dsl-data-refs';
import {
  isContainer,
  getThenIds,
  getElseIds,
  getLoopBodyIds,
  type LayoutStep,
} from './dsl-graph-layout';

// ── Edge model ─────────────────────────────────────────────────────────────
//
// 每条边有两个维度：
//   origin — 边的来源（id 前缀；graphToDsl 靠此反解 dependsOn）
//     dep   = 来自 step.dependsOn
//     order = 来自 body 数组相邻
//     ref   = 来自 context/when 的 steps.X.output 引用
//   visual — 视觉样式（由 data.kind 承载；useRefEdgeToggle 靠此过滤）
//     dep   = 深灰实线，可编辑
//     order = 淡灰实线，不可编辑
//     ref   = 虚线，不可编辑，默认隐藏
//
// 两者通常一致；唯一例外：body 内部 / 跨父的 dependsOn 运行时被忽略，
// 视觉降级为 ref 虚线，但 origin 仍是 dep（保留反解能力）。

export type EdgeKind = 'order' | 'dep' | 'ref';

const EDGE_STYLES: Record<EdgeKind, Record<string, unknown>> = {
  dep:   { stroke: '#64748b', strokeWidth: 1.5 },
  order: { stroke: '#94a3b8', strokeWidth: 1.3, opacity: 0.75 },
  ref:   { stroke: '#cbd5e1', strokeWidth: 1.2, strokeDasharray: '5 4', opacity: 0.85 },
};

function makeEdge(
  origin: EdgeKind,
  source: string,
  target: string,
  visual: EdgeKind = origin,
): Edge {
  const interactive = visual === 'dep';
  return {
    id: `${origin}-${source}-${target}`,
    source,
    target,
    data: { kind: visual },
    style: EDGE_STYLES[visual],
    ...(interactive ? {} : { selectable: false, focusable: false, deletable: false }),
  };
}

const pairKey = (a: string, b: string): string => `${a}>${b}`;

// ── Edge builders ──────────────────────────────────────────────────────────
// 每个 builder 读取共享的 `taken` 集合做去重，并把自己画出的 pair 加进去。
// 调用顺序即优先级：order > dep > ref。

interface DepStep {
  id: string;
  dependsOn?: string[];
  input?: unknown;
  when?: unknown;
}

/** Body 数组相邻 —— 运行时真实执行顺序。 */
function buildOrderEdges(layoutSteps: LayoutStep[], taken: Set<string>): Edge[] {
  const out: Edge[] = [];
  for (const s of layoutSteps) {
    if (!isContainer(s)) continue;
    const lanes = s.type === 'if-else'
      ? [getThenIds(s), getElseIds(s)]
      : [getLoopBodyIds(s)];
    for (const lane of lanes) {
      for (let i = 1; i < lane.length; i++) {
        const key = pairKey(lane[i - 1], lane[i]);
        if (taken.has(key)) continue;
        taken.add(key);
        out.push(makeEdge('order', lane[i - 1], lane[i]));
      }
    }
  }
  return out;
}

/** dependsOn 边：顶层为真依赖画实线；body 内 / 跨父降级为 ref 虚线。 */
function buildDependencyEdges(
  steps: DepStep[],
  parentMap: Map<string, string>,
  taken: Set<string>,
): Edge[] {
  const out: Edge[] = [];
  for (const step of steps) {
    const stepParent = parentMap.get(step.id);
    for (const dep of step.dependsOn ?? []) {
      const key = pairKey(dep, step.id);
      if (taken.has(key)) continue;
      taken.add(key);
      const depParent = parentMap.get(dep);
      const downgrade = !!stepParent || stepParent !== depParent;
      out.push(makeEdge('dep', dep, step.id, downgrade ? 'ref' : 'dep'));
    }
  }
  return out;
}

/** 数据引用：context/when 里的 `steps.X.output`。 */
function buildDataRefEdges(
  steps: DepStep[],
  knownIds: Set<string>,
  taken: Set<string>,
): Edge[] {
  const out: Edge[] = [];
  for (const step of steps) {
    for (const src of extractDataRefs(step, knownIds)) {
      const key = pairKey(src, step.id);
      if (taken.has(key)) continue;
      taken.add(key);
      out.push(makeEdge('ref', src, step.id));
    }
  }
  return out;
}

/** 汇总入口：按优先级顺序生成全部 3 种边，同一 pair 只画一条。 */
export function buildEdges(
  steps: DepStep[],
  layoutSteps: LayoutStep[],
  parentMap: Map<string, string>,
): Edge[] {
  const taken = new Set<string>();
  const knownIds = new Set(steps.map(s => s.id));
  return [
    ...buildOrderEdges(layoutSteps, taken),
    ...buildDependencyEdges(steps, parentMap, taken),
    ...buildDataRefEdges(steps, knownIds, taken),
  ];
}
