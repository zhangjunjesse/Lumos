'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ScheduleNotification {
  id: string;
  scheduleName: string;
  status: 'success' | 'error';
  detail?: string;
  ts: number;
}

interface ScheduleItem {
  id: string;
  name: string;
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'error' | '';
  notifyOnComplete: boolean;
}

function NotificationItem({
  notification,
  onDismiss,
}: {
  notification: ScheduleNotification;
  onDismiss: (id: string) => void;
}) {
  const isSuccess = notification.status === 'success';

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notification.id), 10_000);
    return () => clearTimeout(timer);
  }, [notification.id, onDismiss]);

  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-md text-sm max-w-xs w-full
      ${isSuccess ? 'bg-background border-green-500/30' : 'bg-background border-destructive/30'}`}
    >
      <span className="text-base shrink-0 mt-px">{isSuccess ? '✅' : '❌'}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-xs leading-tight">{isSuccess ? '任务完成' : '任务失败'}</div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">{notification.scheduleName}</div>
        {notification.detail && !isSuccess && (
          <div className="text-xs text-destructive/80 truncate mt-0.5">{notification.detail}</div>
        )}
      </div>
      <button
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-px"
        onClick={() => onDismiss(notification.id)}
        aria-label="关闭"
      >✕</button>
    </div>
  );
}

export function ScheduleNotifications() {
  const [notifications, setNotifications] = useState<ScheduleNotification[]>([]);
  // scheduleId → timestamp of last SSE-shown notification (for dedup with polling)
  const seenSseRef = useRef<Map<string, number>>(new Map());
  // scheduleId → lastRunAt string recorded at last poll
  const pollStateRef = useRef<Map<string, string>>(new Map());
  const pollInitRef = useRef(false);

  const addNotification = useCallback((n: Omit<ScheduleNotification, 'id' | 'ts'>) => {
    setNotifications(prev => [
      ...prev.slice(-4),
      { ...n, id: `${Date.now()}-${Math.random()}`, ts: Date.now() },
    ]);
  }, []);

  // SSE with auto-reconnect on error
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      es = new EventSource('/api/events/global');

      es.addEventListener('schedule:run', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data as string) as {
            data?: { scheduleId?: string; scheduleName?: string; status?: string; detail?: string };
          };
          const d = payload.data ?? {};
          if (d.status === 'success' || d.status === 'error') {
            if (d.scheduleId) seenSseRef.current.set(d.scheduleId, Date.now());
            addNotification({
              scheduleName: d.scheduleName ?? '未知任务',
              status: d.status,
              detail: d.detail,
            });
          }
        } catch { /* ignore */ }
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (!closed) reconnectTimer = setTimeout(connect, 5_000);
      };
    }

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [addNotification]);

  // Polling fallback — catches completions missed by SSE drops
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/workflow/schedules');
        if (!res.ok) return;
        const data = await res.json() as { schedules?: ScheduleItem[] };
        const schedules = data.schedules ?? [];

        if (!pollInitRef.current) {
          for (const s of schedules) pollStateRef.current.set(s.id, s.lastRunAt ?? '');
          pollInitRef.current = true;
          return;
        }

        for (const s of schedules) {
          const prev = pollStateRef.current.get(s.id) ?? '';
          const curr = s.lastRunAt ?? '';
          pollStateRef.current.set(s.id, curr);

          if (!curr || curr === prev) continue;
          if (s.lastRunStatus !== 'success' && s.lastRunStatus !== 'error') continue;
          if (!s.notifyOnComplete) continue;

          // Skip if SSE already showed this (within 90s)
          const sseAt = seenSseRef.current.get(s.id);
          if (sseAt && Date.now() - sseAt < 90_000) continue;

          // Only notify for completions within the last 5 minutes
          if (Date.now() - new Date(curr).getTime() > 300_000) continue;

          addNotification({ scheduleName: s.name, status: s.lastRunStatus });
        }
      } catch { /* ignore */ }
    }

    void poll();
    const timer = setInterval(() => void poll(), 30_000);
    return () => clearInterval(timer);
  }, [addNotification]);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end pointer-events-none">
      {notifications.map((n, index) => (
        <div key={n.id} className="pointer-events-auto" style={{ transform: `translateY(-${index * 4}px)` }}>
          <NotificationItem notification={n} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}
