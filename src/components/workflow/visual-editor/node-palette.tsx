'use client';

import { type DragEvent } from 'react';

interface PaletteItem {
  type: string;
  label: string;
  description: string;
  color: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  { type: 'agent', label: 'Agent', description: '调用 AI Agent 执行任务', color: 'bg-violet-500' },
  { type: 'if-else', label: 'If / Else', description: '根据条件选择分支', color: 'bg-amber-500' },
  { type: 'for-each', label: 'For Each', description: '遍历集合中的每一项', color: 'bg-emerald-500' },
  { type: 'while', label: 'While', description: '条件成立时重复执行', color: 'bg-sky-500' },
  { type: 'wait', label: '等待', description: '暂停执行指定时长', color: 'bg-orange-400' },
];

function onDragStart(event: DragEvent, nodeType: string) {
  event.dataTransfer.setData('application/workflow-node-type', nodeType);
  event.dataTransfer.effectAllowed = 'move';
}

export function NodePalette() {
  return (
    <div className="w-44 shrink-0 border-r border-border/40 bg-muted/20 p-3 space-y-2 overflow-y-auto">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        节点
      </div>
      {PALETTE_ITEMS.map(item => (
        <div
          key={item.type}
          draggable
          onDragStart={e => onDragStart(e, item.type)}
          className="flex items-start gap-2 p-2 rounded-lg border border-border/40 bg-background cursor-grab active:cursor-grabbing hover:border-border hover:shadow-sm transition-all"
        >
          <span className={`mt-0.5 w-2.5 h-2.5 rounded-full ${item.color} shrink-0`} />
          <div className="min-w-0">
            <div className="text-xs font-medium leading-tight">{item.label}</div>
            <div className="text-[10px] text-muted-foreground leading-snug mt-0.5">{item.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
