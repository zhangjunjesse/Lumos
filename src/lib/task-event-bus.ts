import { EventEmitter } from 'events';

// Declared for globalThis HMR persistence
declare global {
  // eslint-disable-next-line no-var
  var __lumos_task_event_bus__: TaskEventBus | undefined;
}

export type TaskEventType =
  | 'task:created'
  | 'task:updated'
  | 'task:approval-changed'
  | 'stage:started'
  | 'stage:progress'
  | 'stage:completed'
  | 'stage:failed'
  | 'run:started'
  | 'run:completed'
  | 'run:cancelled'
  | 'schedule:run';

export const GLOBAL_SESSION_ID = '__global__';

export interface TaskEvent {
  type: TaskEventType;
  sessionId: string;
  taskId: string;
  runId?: string;
  stageId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface GlobalEvent {
  type: TaskEventType;
  data?: Record<string, unknown>;
}

class TaskEventBus extends EventEmitter {
  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  /** Use globalThis so the singleton survives Next.js HMR module re-evaluations in dev mode. */
  static getInstance(): TaskEventBus {
    if (!global.__lumos_task_event_bus__) {
      global.__lumos_task_event_bus__ = new TaskEventBus();
    }
    return global.__lumos_task_event_bus__;
  }

  emitTaskEvent(event: TaskEvent): void {
    this.emit('task-event', event);
    this.emit(event.type, event);
  }

  emitGlobalEvent(event: GlobalEvent): void {
    const taskEvent: TaskEvent = {
      type: event.type,
      sessionId: GLOBAL_SESSION_ID,
      taskId: '',
      timestamp: Date.now(),
      data: event.data,
    };
    this.emit('task-event', taskEvent);
    this.emit('global-event', taskEvent);
  }

  onTaskEvent(listener: (event: TaskEvent) => void): () => void {
    this.on('task-event', listener);
    return () => this.off('task-event', listener);
  }

  onSessionEvents(
    sessionId: string,
    listener: (event: TaskEvent) => void,
  ): () => void {
    const filtered = (event: TaskEvent) => {
      if (event.sessionId === sessionId || event.sessionId === GLOBAL_SESSION_ID) {
        listener(event);
      }
    };
    this.on('task-event', filtered);
    return () => this.off('task-event', filtered);
  }
}

export const taskEventBus = TaskEventBus.getInstance();
