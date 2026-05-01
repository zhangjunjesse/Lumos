'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface TaskSSEEvent {
  type: string;
  taskId?: string;
  runId?: string;
  stageId?: string;
  data?: Record<string, unknown>;
}

interface UseTaskEventsOptions {
  sessionId: string;
  enabled?: boolean;
  onEvent?: (event: TaskSSEEvent) => void;
  onSnapshot?: (banner: unknown) => void;
}

export function useTaskEvents({
  sessionId,
  enabled = true,
  onEvent,
  onSnapshot,
}: UseTaskEventsOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId) {
      cleanup();
      return;
    }

    const connect = () => {
      cleanup();

      const url = `/api/sessions/${encodeURIComponent(sessionId)}/events`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.addEventListener('snapshot', (e) => {
        retriesRef.current = 0;
        try {
          const payload = JSON.parse(e.data);
          onSnapshot?.(payload.banner);
        } catch { /* ignore */ }
      });

      const taskEventTypes = [
        'task:created', 'task:updated', 'task:approval-changed',
        'stage:started', 'stage:progress', 'stage:completed', 'stage:failed',
        'run:started', 'run:completed', 'run:cancelled',
      ];

      for (const eventType of taskEventTypes) {
        es.addEventListener(eventType, (e) => {
          try {
            const data = JSON.parse(e.data);
            onEvent?.({ type: eventType, ...data });
          } catch { /* ignore */ }
        });
      }

      es.addEventListener('heartbeat', () => {
        retriesRef.current = 0;
      });

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        const delay = Math.min(1000 * 2 ** retriesRef.current, 30_000);
        retriesRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return cleanup;
  }, [sessionId, enabled, cleanup, onEvent, onSnapshot]);
}
