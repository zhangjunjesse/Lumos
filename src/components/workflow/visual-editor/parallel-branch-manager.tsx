'use client';

import { useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BodyChildInfo } from './body-manager';

const TYPE_DOT_CLASS: Record<string, string> = {
  agent: 'bg-violet-500',
  'if-else': 'bg-amber-500',
  'for-each': 'bg-emerald-500',
  while: 'bg-sky-500',
  wait: 'bg-orange-400',
  notification: 'bg-blue-500',
  capability: 'bg-teal-500',
  parallel: 'bg-fuchsia-500',
  join: 'bg-slate-500',
  approval: 'bg-rose-500',
};

interface SortableRowProps {
  index: number;
  item: BodyChildInfo;
}

function SortableRow({ index, item }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.stepId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 px-1.5 py-1 rounded border border-border/40 bg-background hover:border-primary/40 transition-colors"
    >
      <button
        type="button"
        aria-label="拖动排序"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <span className="text-[9px] font-mono text-muted-foreground w-5 text-center shrink-0">#{index}</span>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_DOT_CLASS[item.stepType] ?? 'bg-slate-400'}`} />
      <span className="text-[10px] truncate flex-1">{item.label}</span>
      <span className="text-[9px] text-muted-foreground font-mono shrink-0">{item.stepId}</span>
    </div>
  );
}

export interface ParallelBranchManagerProps {
  branchIds: string[];
  childNodes: Record<string, BodyChildInfo>;
  onReorder: (order: string[]) => void;
}

export function ParallelBranchManager({ branchIds, childNodes, onReorder }: ParallelBranchManagerProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const items = useMemo(
    () => branchIds.map(id => childNodes[id]).filter((x): x is BodyChildInfo => Boolean(x)),
    [branchIds, childNodes],
  );

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = branchIds.indexOf(String(e.active.id));
    const newIdx = branchIds.indexOf(String(e.over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    onReorder(arrayMove(branchIds, oldIdx, newIdx));
  };

  return (
    <div className="space-y-1 border-t border-border/30 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold">分支顺序</span>
        <span className="text-[9px] text-muted-foreground">{items.length} 路并行</span>
      </div>
      {items.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={branchIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {items.map((item, i) => (
                <SortableRow key={item.stepId} index={i} item={item} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="text-[9px] text-muted-foreground italic px-1">尚无并行分支，从画布拖动连线生成。</div>
      )}
      <p className="text-[9px] text-muted-foreground leading-tight">
        #0 为最先启动的分支；重新排序会更新每条 next 出边的 branchIndex。
      </p>
    </div>
  );
}
