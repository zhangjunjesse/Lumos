'use client';

import { useMemo, useState } from 'react';
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
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface BodyChildInfo {
  stepId: string;
  label: string;
  stepType: string;
}

interface SortableItemProps {
  item: BodyChildInfo;
  onRemove: () => void;
}

const TYPE_DOT_CLASS: Record<string, string> = {
  agent: 'bg-violet-500',
  'if-else': 'bg-amber-500',
  'for-each': 'bg-emerald-500',
  while: 'bg-sky-500',
  wait: 'bg-orange-400',
  notification: 'bg-blue-500',
  capability: 'bg-teal-500',
};

function SortableItem({ item, onRemove }: SortableItemProps) {
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
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_DOT_CLASS[item.stepType] ?? 'bg-slate-400'}`} />
      <span className="text-[10px] truncate flex-1">{item.label}</span>
      <span className="text-[9px] text-muted-foreground font-mono shrink-0">{item.stepId}</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-[10px] text-muted-foreground hover:text-red-500 px-0.5"
        title="从此分支移除"
      >
        ×
      </button>
    </div>
  );
}

interface BodyListProps {
  title: string;
  ids: string[];
  childNodes: Record<string, BodyChildInfo>;
  availableIds: string[];
  onChange: (ids: string[]) => void;
}

function BodyList({ title, ids, childNodes, availableIds, onChange }: BodyListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [addSel, setAddSel] = useState<string>('');

  const items = useMemo(
    () => ids.map(id => childNodes[id]).filter((x): x is BodyChildInfo => Boolean(x)),
    [ids, childNodes],
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = ids.indexOf(String(e.active.id));
    const newIdx = ids.indexOf(String(e.over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    onChange(arrayMove(ids, oldIdx, newIdx));
  };

  const removeAt = (id: string) => onChange(ids.filter(x => x !== id));

  const addableIds = availableIds.filter(id => !ids.includes(id));

  const handleAdd = () => {
    if (!addSel) return;
    onChange([...ids, addSel]);
    setAddSel('');
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground">{title}</span>
        <span className="text-[9px] text-muted-foreground">{ids.length} 项</span>
      </div>
      {items.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {items.map(item => (
                <SortableItem key={item.stepId} item={item} onRemove={() => removeAt(item.stepId)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="text-[9px] text-muted-foreground italic px-1">无子步骤</div>
      )}
      {addableIds.length > 0 && (
        <div className="flex gap-1 pt-0.5">
          <Select value={addSel} onValueChange={setAddSel}>
            <SelectTrigger className="h-6 text-[10px] flex-1">
              <SelectValue placeholder="添加步骤" />
            </SelectTrigger>
            <SelectContent>
              {addableIds.map(id => (
                <SelectItem key={id} value={id} className="text-[10px]">
                  {childNodes[id]?.label ?? id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-6 text-[10px] px-2" onClick={handleAdd} disabled={!addSel}>
            +
          </Button>
        </div>
      )}
    </div>
  );
}

export interface BodyManagerProps {
  stepType: 'if-else' | 'for-each' | 'while';
  body?: string[];
  thenIds?: string[];
  elseIds?: string[];
  childNodes: Record<string, BodyChildInfo>;
  availableIds: string[];
  onReorder: (order: { body?: string[]; then?: string[]; else?: string[] }) => void;
}

export function BodyManager({
  stepType, body = [], thenIds = [], elseIds = [], childNodes, availableIds, onReorder,
}: BodyManagerProps) {
  if (stepType === 'if-else') {
    return (
      <div className="space-y-2 border-t border-border/30 pt-2">
        <span className="text-[10px] font-semibold">分支管理</span>
        <BodyList
          title="THEN"
          ids={thenIds}
          childNodes={childNodes}
          availableIds={availableIds}
          onChange={next => onReorder({ then: next, else: elseIds })}
        />
        <BodyList
          title="ELSE"
          ids={elseIds}
          childNodes={childNodes}
          availableIds={availableIds}
          onChange={next => onReorder({ then: thenIds, else: next })}
        />
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-border/30 pt-2">
      <span className="text-[10px] font-semibold">循环体管理</span>
      <BodyList
        title="BODY"
        ids={body}
        childNodes={childNodes}
        availableIds={availableIds}
        onChange={next => onReorder({ body: next })}
      />
    </div>
  );
}
