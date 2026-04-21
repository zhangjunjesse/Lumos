'use client';

import { useState, type DragEvent } from 'react';

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
  { type: 'parallel', label: 'Parallel', description: '多分支并行执行', color: 'bg-sky-500' },
  { type: 'join', label: 'Join', description: '并行分支汇合', color: 'bg-sky-500' },
  { type: 'approval', label: '人工审批', description: '暂停等待人工批准', color: 'bg-amber-500' },
  { type: 'wait', label: '等待', description: '暂停执行指定时长', color: 'bg-orange-400' },
];

function onDragStart(event: DragEvent, nodeType: string) {
  event.dataTransfer.setData('application/workflow-node-type', nodeType);
  event.dataTransfer.effectAllowed = 'move';
}

export function NodePalette() {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="w-8 shrink-0 border-r border-border/40 bg-muted/20 flex flex-col items-center py-2 gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="展开节点面板"
        >
          &#9654;
        </button>
        {PALETTE_ITEMS.map(item => (
          <div
            key={item.type}
            draggable
            onDragStart={e => onDragStart(e, item.type)}
            className="w-4 h-4 rounded-full cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
            title={item.label}
          >
            <span className={`block w-full h-full rounded-full ${item.color}`} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="w-44 shrink-0 border-r border-border/40 bg-muted/20 p-3 space-y-2 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          节点
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="收起节点面板"
        >
          &#9664;
        </button>
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
