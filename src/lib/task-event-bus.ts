import { EventEmitter } from 'events';

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
  | 'run:cancelled';

export interface TaskEvent {
  type: TaskEventType;
  sessionId: string;
  taskId: string;
  runId?: string;
  stageId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

class TaskEventBus extends EventEmitter {
  private static instance: TaskEventBus | null = null;

  private constructor() {
    super();
    this.setMaxListeners(50);
  }

  static getInstance(): TaskEventBus {
    if (!TaskEventBus.instance) {
      TaskEventBus.instance = new TaskEventBus();
    }
    return TaskEventBus.instance;
  }

  emitTaskEvent(event: TaskEvent): void {
    this.emit('task-event', event);
    this.emit(event.type, event);
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
      if (event.sessionId === sessionId) {
        listener(event);
      }
    };
    this.on('task-event', filtered);
    return () => this.off('task-event', filtered);
  }
}

export const taskEventBus = TaskEventBus.getInstance();
