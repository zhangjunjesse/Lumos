'use client';

import { useState, useCallback, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { useTaskEvents, type TaskSSEEvent } from '@/hooks/useTaskEvents';

interface ActivityEntry {
  id: string;
  type: string;
  time: string;
  title: string;
  detail?: string;
  icon: string;
}

interface TaskActivityPanelProps {
  sessionId: string;
}

const EVENT_CONFIG: Record<string, { icon: string; label: string }> = {
  'task:created': { icon: '📋', label: '任务已创建' },
  'task:updated': { icon: '✏️', label: '任务已更新' },
  'task:approval-changed': { icon: '✓', label: '审批状态变更' },
  'run:started': { icon: '▶', label: '开始执行' },
  'run:completed': { icon: '✅', label: '执行完成' },
  'run:cancelled': { icon: '⊘', label: '执行已取消' },
  'stage:started': { icon: '🔄', label: '阶段开始' },
  'stage:completed': { icon: '✅', label: '阶段完成' },
  'stage:failed': { icon: '❌', label: '阶段失败' },
  'stage:progress': { icon: '📊', label: '进度更新' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function buildEntry(event: TaskSSEEvent): ActivityEntry {
  const cfg = EVENT_CONFIG[event.type] || { icon: '•', label: event.type };
  return {
    id: `${event.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: event.type,
    time: formatTime(Date.now()),
    title: cfg.label,
    detail: event.data?.stageStatus ? String(event.data.stageStatus) : undefined,
    icon: cfg.icon,
  };
}

export function TaskActivityPanel({ sessionId }: TaskActivityPanelProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleEvent = useCallback((event: TaskSSEEvent) => {
    setEntries((prev) => [buildEntry(event), ...prev].slice(0, 50));
  }, []);

  useTaskEvents({
    sessionId,
    enabled: true,
    onEvent: handleEvent,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-medium">任务活动</h3>
        <Badge variant="secondary" className="text-xs">
          {entries.length}
        </Badge>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-2">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            暂无活动
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div key={entry.id} className="flex gap-3 text-sm">
                <span className="text-xs text-muted-foreground w-10 pt-0.5 text-right flex-shrink-0">
                  {entry.time}
                </span>
                <div className="flex-shrink-0 pt-0.5">{entry.icon}</div>
                <div className="min-w-0">
                  <div className="font-medium text-foreground/90">{entry.title}</div>
                  {entry.detail && (
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">
                      {entry.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
