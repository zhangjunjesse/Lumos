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
}

function buildLayers(steps: DslStep[]): DslStep[][] {
  const stepMap = new Map<string, DslStep>();
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const order = new Map<string, number>();

  steps.forEach((step, i) => {
    stepMap.set(step.id, step);
    indegree.set(step.id, step.dependsOn?.length ?? 0);
    order.set(step.id, i);
  });

  steps.forEach((step) => {
    for (const dep of step.dependsOn ?? []) {
      if (!stepMap.has(dep)) continue;
      const list = dependents.get(dep) ?? [];
      list.push(step.id);
      dependents.set(dep, list);
    }
  });

  const layers: DslStep[][] = [];
  const remaining = new Set(steps.map((s) => s.id));

  while (remaining.size > 0) {
    const ready = Array.from(remaining)
      .filter((id) => (indegree.get(id) ?? 0) === 0)
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

    if (ready.length === 0) return [steps];
    layers.push(ready.map((id) => stepMap.get(id)!));
    for (const id of ready) {
      remaining.delete(id);
      for (const dep of dependents.get(id) ?? []) {
        indegree.set(dep, (indegree.get(dep) ?? 0) - 1);
      }
    }
  }

  return layers;
}

const STEP_TYPE_STYLE: Record<string, { badge: string; cls: string }> = {
  agent: { badge: 'agent', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20' },
  'if-else': { badge: 'if/else', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20' },
  'for-each': { badge: 'for-each', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20' },
  while: { badge: 'while', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20' },
  notification: { badge: 'notify', cls: 'bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20' },
  capability: { badge: 'cap', cls: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20' },
};

function getStepLabel(step: DslStep, presetNames: Record<string, string>): string {
  if (step.type === 'agent') {
    const preset = step.input?.preset;
    return typeof preset === 'string' ? (presetNames[preset] || preset) : step.id;
  }
  if (step.type === 'if-else') return 'IF / ELSE';
  if (step.type === 'for-each') return 'FOR EACH';
  if (step.type === 'while') return 'WHILE';
  return step.id;
}

function getCodeModeLabel(step: DslStep): string | null {
  const code = step.input?.code as { script?: string; handler?: string; strategy?: string } | undefined;
  if (!code?.script && !code?.handler) return null;
  return code.strategy === 'code-only' ? 'code' : 'code+';
}

function getStepDetail(step: DslStep): string {
  if (step.type === 'agent') {
    return typeof step.input?.prompt === 'string' ? step.input.prompt : '';
  }
  if (step.type === 'if-else') {
    const thenIds = Array.isArray(step.input?.then) ? step.input.then : [];
    const elseIds = Array.isArray(step.input?.else) ? step.input.else : [];
    return `then: [${(thenIds as string[]).join(', ')}]${elseIds.length ? ` else: [${(elseIds as string[]).join(', ')}]` : ''}`;
  }
  if (step.type === 'for-each') {
    const body = Array.isArray(step.input?.body) ? step.input.body : [];
    return `${step.input?.collection || '?'} -> [${(body as string[]).join(', ')}]`;
  }
  if (step.type === 'while') {
    const body = Array.isArray(step.input?.body) ? step.input.body : [];
    return `body: [${(body as string[]).join(', ')}]`;
  }
  return '';
}

interface WorkflowDslGraphProps {
  steps: DslStep[];
  presetNames?: Record<string, string>;
  selectedStepId?: string | null;
  onStepClick?: (stepId: string) => void;
}

export function WorkflowDslGraph({
  steps,
  presetNames = {},
  selectedStepId,
  onStepClick,
}: WorkflowDslGraphProps) {
  const graph = useMemo(() => {
    if (steps.length === 0) return null;

    const layers = buildLayers(steps);
    const nodeWidth = 184;
    const nodeHeight = 80;
    const colGap = 56;
    const rowGap = 16;
    const padX = 20;
    const padTop = 40;
    const padBottom = 20;

    const maxRows = Math.max(...layers.map((l) => l.length));
    const innerH = maxRows * nodeHeight + Math.max(0, maxRows - 1) * rowGap;
    const totalW = padX * 2 + layers.length * nodeWidth + Math.max(0, layers.length - 1) * colGap;
    const totalH = padTop + padBottom + innerH;

    const nodes: NodeLayout[] = [];
    const nodeMap = new Map<string, NodeLayout>();

    layers.forEach((layer, col) => {
      const x = padX + col * (nodeWidth + colGap);
      const layerH = layer.length * nodeHeight + Math.max(0, layer.length - 1) * rowGap;
      const startY = padTop + (innerH - layerH) / 2;
      layer.forEach((step, row) => {
        const node = { step, x, y: startY + row * (nodeHeight + rowGap) };
        nodes.push(node);
        nodeMap.set(step.id, node);
      });
    });

    const edges = steps.flatMap((step) =>
      (step.dependsOn ?? []).flatMap((depId) => {
        const src = nodeMap.get(depId);
        const tgt = nodeMap.get(step.id);
        if (!src || !tgt) return [];
        const fx = src.x + nodeWidth;
        const fy = src.y + nodeHeight / 2;
        const tx = tgt.x;
        const ty = tgt.y + nodeHeight / 2;
        const c = Math.max(24, (tx - fx) * 0.38);
        return [{ key: `${depId}->${step.id}`, path: `M ${fx} ${fy} C ${fx + c} ${fy}, ${tx - c} ${ty}, ${tx} ${ty}` }];
      }),
    );

    const layerLabels = layers.map((layer, i) => ({
      key: `l${i}`,
      x: padX + i * (nodeWidth + colGap) + nodeWidth / 2,
      label: layer.length > 1 ? `第 ${i + 1} 层 · 并行 ${layer.length}` : `第 ${i + 1} 层`,
    }));

    return { totalW, totalH, nodeWidth, nodeHeight, nodes, edges, layerLabels };
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
          {graph.edges.map((e) => (
            <path key={e.key} d={e.path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-300" markerEnd="url(#dsl-arrow)" />
          ))}
        </svg>

        {graph.layerLabels.map((l) => (
          <div
            key={l.key}
            className="absolute -translate-x-1/2 rounded-full border border-border/60 bg-background/90 px-3 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
            style={{ left: `${l.x}px`, top: '14px' }}
          >
            {l.label}
          </div>
        ))}

        {graph.nodes.map(({ step, x, y }) => {
          const label = getStepLabel(step, presetNames);
          const detail = getStepDetail(step);
          const codeLabel = getCodeModeLabel(step);
          const style = STEP_TYPE_STYLE[step.type] || STEP_TYPE_STYLE.agent;
          const isSelected = selectedStepId === step.id;
          const isClickable = !!onStepClick;
          const tMs = step.policy?.timeoutMs;
          const timeoutLabel = typeof tMs === 'number' && tMs > 0
            ? (tMs >= 60_000 ? `${Math.round(tMs / 60_000)}m` : `${Math.round(tMs / 1000)}s`)
            : null;

          return (
            <div
              key={step.id}
              className={[
                'absolute rounded-xl border bg-background/95 px-3 py-2 shadow-sm transition-all',
                isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border/60',
                isClickable ? 'cursor-pointer hover:border-primary/50 hover:shadow-md' : '',
              ].join(' ')}
              style={{ left: `${x}px`, top: `${y}px`, width: `${graph.nodeWidth}px`, minHeight: `${graph.nodeHeight}px` }}
              onClick={() => onStepClick?.(step.id)}
              title={detail || step.id}
            >
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className={`text-[9px] px-1 py-0 h-3.5 shrink-0 ${style.cls}`}>
                  {style.badge}
                </Badge>
                <span className="text-xs font-semibold text-foreground truncate flex-1">{label}</span>
                {codeLabel && (
                  <span className="text-[8px] bg-emerald-500/15 text-emerald-600 px-1 rounded shrink-0">{codeLabel}</span>
                )}
                {timeoutLabel && <span className="text-[9px] text-muted-foreground shrink-0">{timeoutLabel}</span>}
              </div>
              <div className="text-[9px] text-muted-foreground mt-0.5 font-mono truncate">{step.id}</div>
              {detail && (
                <div className="mt-1 text-[10px] text-muted-foreground leading-snug line-clamp-1 truncate">
                  {detail}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
