import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';

interface DslStep {
  id: string;
  type: string;
  dependsOn?: string[];
  input?: Record<string, unknown>;
  policy?: { timeoutMs?: number };
}

interface NodeLayout {
  step: DslStep;
  x: number;
  y: number;
  height: number;
}

const CONTAINERS = new Set(['while', 'for-each', 'if-else']);
const NODE_W = 210;
const NODE_H = 80;
const BODY_ROW_H = 36;
const BODY_ROW_GAP = 4;
const CONTAINER_HEADER_H = 46;

function collectBodyIds(steps: DslStep[]): Set<string> {
  const ids = new Set<string>();
  for (const s of steps) {
    if (!s.input || !CONTAINERS.has(s.type)) continue;
    for (const id of [
      ...((s.input.body as string[] | undefined) ?? []),
      ...((s.input.then as string[] | undefined) ?? []),
      ...((s.input.else as string[] | undefined) ?? []),
    ]) ids.add(id);
  }
  return ids;
}

function getBodySteps(step: DslStep, map: Map<string, DslStep>): DslStep[] {
  if (!step.input) return [];
  const ids = [
    ...((step.input.body as string[] | undefined) ?? []),
    ...((step.input.then as string[] | undefined) ?? []),
    ...((step.input.else as string[] | undefined) ?? []),
  ];
  return ids.map(id => map.get(id)).filter((s): s is DslStep => Boolean(s));
}

function calcHeight(step: DslStep, map: Map<string, DslStep>): number {
  const body = getBodySteps(step, map);
  if (body.length === 0) return NODE_H;
  return CONTAINER_HEADER_H + body.length * (BODY_ROW_H + BODY_ROW_GAP) - BODY_ROW_GAP + 14;
}

function fmtCond(c: unknown): string {
  if (!c || typeof c !== 'object') return '';
  const o = c as Record<string, unknown>;
  const v = (x: unknown) => String(x).replace(/^steps\.([^.]+)\.output\.?/, '$1.');
  const ops: Record<string, string> = { eq: '==', neq: '!=', gt: '>', lt: '<' };
  if (o.op === 'exists') return `exists(${v(o.ref)})`;
  if (o.op && o.left !== undefined && o.right !== undefined)
    return `${v(o.left)} ${ops[o.op as string] ?? o.op} ${v(o.right)}`;
  return '';
}

function containerDetail(step: DslStep): string {
  if (step.type === 'while') {
    const max = typeof step.input?.maxIterations === 'number' ? step.input.maxIterations : 20;
    return `max:${max}  ${fmtCond(step.input?.condition)}`;
  }
  if (step.type === 'for-each') return `in ${step.input?.collection ?? '?'}`;
  if (step.type === 'if-else') return fmtCond(step.input?.condition);
  return '';
}

function buildLayers(steps: DslStep[]): DslStep[][] {
  const map = new Map<string, DslStep>();
  const indegree = new Map<string, number>();
  const deps = new Map<string, string[]>();
  const order = new Map<string, number>();
  steps.forEach((s, i) => { map.set(s.id, s); indegree.set(s.id, s.dependsOn?.length ?? 0); order.set(s.id, i); });
  steps.forEach(s => { for (const d of s.dependsOn ?? []) { if (!map.has(d)) continue; deps.set(d, [...(deps.get(d) ?? []), s.id]); } });
  const layers: DslStep[][] = [];
  const remaining = new Set(steps.map(s => s.id));
  while (remaining.size > 0) {
    const ready = [...remaining].filter(id => (indegree.get(id) ?? 0) === 0).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    if (ready.length === 0) return [steps];
    layers.push(ready.map(id => map.get(id)!));
    for (const id of ready) { remaining.delete(id); for (const d of deps.get(id) ?? []) indegree.set(d, (indegree.get(d) ?? 0) - 1); }
  }
  return layers;
}

const STYLE: Record<string, { badge: string; cls: string; dot: string; divider?: string }> = {
  agent: { badge: 'agent', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20', dot: 'bg-violet-500' },
  'if-else': { badge: 'if/else', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20', dot: 'bg-amber-500', divider: 'border-amber-500/20' },
  'for-each': { badge: 'for-each', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-500', divider: 'border-emerald-500/20' },
  while: { badge: 'while', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20', dot: 'bg-sky-500', divider: 'border-sky-500/20' },
  wait: { badge: 'wait', cls: 'bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/20', dot: 'bg-gray-500' },
  notification: { badge: 'notify', cls: 'bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20', dot: 'bg-pink-500' },
  capability: { badge: 'cap', cls: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20', dot: 'bg-orange-500' },
};

function getLabel(step: DslStep, names: Record<string, string>): string {
  if (step.type === 'agent') { const p = step.input?.preset; return typeof p === 'string' ? (names[p] || step.id) : step.id; }
  if (step.type === 'if-else') return 'IF / ELSE';
  if (step.type === 'for-each') return 'FOR EACH';
  if (step.type === 'while') return step.input?.mode === 'do-while' ? 'DO-WHILE' : 'WHILE';
  return step.id;
}

function timeoutLabel(step: DslStep): string | null {
  const ms = step.policy?.timeoutMs;
  if (typeof ms !== 'number' || ms <= 0) return null;
  return ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`;
}

interface WorkflowDslGraphProps {
  steps: DslStep[];
  presetNames?: Record<string, string>;
  selectedStepId?: string | null;
  onStepClick?: (stepId: string) => void;
}

export function WorkflowDslGraph({ steps, presetNames = {}, selectedStepId, onStepClick }: WorkflowDslGraphProps) {
  const graph = useMemo(() => {
    if (steps.length === 0) return null;
    const stepMap = new Map(steps.map(s => [s.id, s]));
    const bodyIds = collectBodyIds(steps);
    const topLevel = steps.filter(s => !bodyIds.has(s.id));
    const layers = buildLayers(topLevel);

    const colGap = 56; const rowGap = 16; const padX = 20; const padTop = 40; const padBottom = 20;
    const layerHeights = layers.map(l => l.reduce((sum, s) => sum + calcHeight(s, stepMap) + rowGap, 0) - rowGap);
    const innerH = Math.max(...layerHeights, NODE_H);
    const totalW = padX * 2 + layers.length * NODE_W + Math.max(0, layers.length - 1) * colGap;
    const totalH = padTop + padBottom + innerH;

    const nodes: NodeLayout[] = [];
    const nodeMap = new Map<string, NodeLayout>();
    layers.forEach((layer, col) => {
      const x = padX + col * (NODE_W + colGap);
      const layerH = layer.reduce((sum, s) => sum + calcHeight(s, stepMap) + rowGap, 0) - rowGap;
      let cy = padTop + (innerH - layerH) / 2;
      layer.forEach(step => {
        const h = calcHeight(step, stepMap);
        const n = { step, x, y: cy, height: h };
        nodes.push(n); nodeMap.set(step.id, n);
        cy += h + rowGap;
      });
    });

    const edges = topLevel.flatMap(step =>
      (step.dependsOn ?? []).filter(d => !bodyIds.has(d)).flatMap(depId => {
        const src = nodeMap.get(depId); const tgt = nodeMap.get(step.id);
        if (!src || !tgt) return [];
        const fx = src.x + NODE_W, fy = src.y + src.height / 2, tx = tgt.x, ty = tgt.y + tgt.height / 2;
        const c = Math.max(24, (tx - fx) * 0.38);
        return [{ key: `${depId}->${step.id}`, path: `M ${fx} ${fy} C ${fx + c} ${fy}, ${tx - c} ${ty}, ${tx} ${ty}` }];
      }),
    );

    const layerLabels = layers.map((l, i) => ({
      key: `l${i}`, x: padX + i * (NODE_W + colGap) + NODE_W / 2,
      label: l.length > 1 ? `第 ${i + 1} 层 · 并行 ${l.length}` : `第 ${i + 1} 层`,
    }));

    return { totalW, totalH, nodes, edges, layerLabels, stepMap };
  }, [steps]);

  if (!graph) return null;

  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="relative rounded-2xl border border-border/60 bg-gradient-to-br from-violet-500/5 via-background to-sky-500/5"
        style={{ width: `${Math.max(graph.totalW, 480)}px`, minHeight: `${graph.totalH}px` }}
      >
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${Math.max(graph.totalW, 480)} ${graph.totalH}`} aria-hidden="true">
          <defs>
            <marker id="dsl-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L8,3 z" className="fill-slate-400" />
            </marker>
          </defs>
          {graph.edges.map(e => (
            <path key={e.key} d={e.path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-300" markerEnd="url(#dsl-arrow)" />
          ))}
        </svg>

        {graph.layerLabels.map(l => (
          <div key={l.key} className="absolute -translate-x-1/2 rounded-full border border-border/60 bg-background/90 px-3 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm" style={{ left: `${l.x}px`, top: '14px' }}>
            {l.label}
          </div>
        ))}

        {graph.nodes.map(({ step, x, y, height }) => {
          const label = getLabel(step, presetNames);
          const st = STYLE[step.type] || STYLE.agent;
          const isSelected = selectedStepId === step.id;
          const isCont = CONTAINERS.has(step.type);
          const body = isCont ? getBodySteps(step, graph.stepMap) : [];
          const tl = timeoutLabel(step);

          return (
            <div
              key={step.id}
              className={[
                'absolute rounded-xl border shadow-sm transition-all overflow-hidden',
                isSelected ? 'border-primary ring-2 ring-primary/20' : isCont && body.length > 0 ? `border-current/20 ${st.cls.split(' ').find(c => c.startsWith('border-')) ?? 'border-border/60'}` : 'border-border/60',
                isCont && body.length > 0 ? (st.cls.split(' ').find(c => c.startsWith('bg-')) ?? 'bg-background/95') : 'bg-background/95',
              ].join(' ')}
              style={{ left: `${x}px`, top: `${y}px`, width: `${NODE_W}px`, height: `${height}px` }}
              onClick={() => onStepClick?.(step.id)}
            >
              {/* Header */}
              <div className={`px-3 py-2 ${isCont && body.length > 0 ? `border-b ${st.divider ?? 'border-border/30'}` : ''}`}>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={`text-[9px] px-1 py-0 h-3.5 shrink-0 ${st.cls}`}>{st.badge}</Badge>
                  <span className="text-xs font-semibold text-foreground truncate flex-1">{label}</span>
                  {tl && <span className="text-[9px] text-muted-foreground shrink-0">{tl}</span>}
                </div>
                {isCont && body.length > 0 ? (
                  <div className="text-[9px] text-muted-foreground mt-0.5 truncate">{containerDetail(step)}</div>
                ) : (
                  <div className="text-[9px] text-muted-foreground mt-0.5 font-mono truncate">{step.id}</div>
                )}
              </div>

              {/* Inline body steps */}
              {body.length > 0 && (
                <div className="px-2 pb-1.5 space-y-0">
                  {body.map((bs, i) => {
                    const bst = STYLE[bs.type] || STYLE.agent;
                    const bl = getLabel(bs, presetNames);
                    const bSel = selectedStepId === bs.id;
                    return (
                      <div key={bs.id}>
                        {i > 0 && <div className="flex justify-center h-3"><div className="w-px h-full bg-border/50" /></div>}
                        <div
                          className={[
                            'flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors',
                            bSel ? 'border-primary bg-primary/5' : 'border-border/40 bg-background/80 hover:border-primary/40',
                            onStepClick ? 'cursor-pointer' : '',
                          ].join(' ')}
                          onClick={e => { e.stopPropagation(); onStepClick?.(bs.id); }}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${bst.dot}`} />
                          <span className="text-[10px] font-medium truncate flex-1">{bl}</span>
                          <span className="text-[8px] text-muted-foreground font-mono shrink-0">{bs.id}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
