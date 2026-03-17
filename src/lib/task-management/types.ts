// Task Management 类型定义

export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface TaskError {
  code: string;
  message: string;
  details?: any;
}

export interface Task {
  id: string;
  sessionId: string;
  summary: string;
  requirements: string[];
  status: TaskStatus;
  progress?: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedDuration?: number;
  result?: any;
  errors?: TaskError[];
  metadata?: Record<string, any>;
}

export interface TaskSummary {
  id: string;
  summary: string;
  status: TaskStatus;
  progress?: number;
  createdAt: string;
}

// API 请求/响应类型
export interface CreateTaskRequest {
  taskSummary: string;
  requirements: string[];
  context: {
    sessionId: string;
    relevantMessages?: string[];
  };
}

export interface CreateTaskResponse {
  taskId: string;
  status: 'pending';
  createdAt: string;
}

export interface ListTasksRequest {
  sessionId?: string;
  status?: TaskStatus[];
  limit?: number;
  offset?: number;
}

export interface ListTasksResponse {
  tasks: TaskSummary[];
  total: number;
}

export interface GetTaskDetailRequest {
  taskId: string;
}

export interface GetTaskDetailResponse {
  task: Task;
}

export interface CancelTaskRequest {
  taskId: string;
  reason?: string;
}

export interface CancelTaskResponse {
  success: boolean;
  message?: string;
}

export interface UpdateTaskStatusRequest {
  taskId: string;
  status: TaskStatus;
  progress?: number;
  result?: any;
  errors?: TaskError[];
  metadata?: Record<string, any>;
}

export interface UpdateTaskStatusResponse {
  success: boolean;
}

// Scheduling Layer 接口类型
export interface SubmitTaskRequest {
  taskId: string;
  task: Task;
}

export interface SubmitTaskResponse {
  accepted: boolean;
  message?: string;
}

// 任务完成通知接口
export interface TaskCompletionNotification {
  taskId: string;
  status: TaskStatus.COMPLETED | TaskStatus.FAILED;
  result?: any;
  errors?: TaskError[];
}

export interface NotifyTaskCompletionRequest {
  sessionId: string;
  notification: TaskCompletionNotification;
}

export interface NotifyTaskCompletionResponse {
  success: boolean;
}
