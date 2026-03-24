// Task Management 类型定义
import type { WorkflowDSL } from '@/lib/workflow/types';

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
  details?: unknown;
}

export interface Task {
  id: string;
  sessionId: string;
  sourceMessageId?: string;
  sourceAssistantMessageId?: string;
  summary: string;
  requirements: string[];
  status: TaskStatus;
  progress?: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedDuration?: number;
  result?: unknown;
  errors?: TaskError[];
  metadata?: Record<string, unknown>;
}

export interface TaskSummary {
  id: string;
  summary: string;
  status: TaskStatus;
  progress?: number;
  estimatedDuration?: number;
  strategy?: 'simple' | 'workflow';
  createdAt: string;
}

// API 请求/响应类型
export interface CreateTaskRequest {
  taskSummary: string;
  requirements: string[];
  context: {
    sessionId: string;
    relevantMessages?: string[];
    sourceMessageId?: string;
    sourceAssistantMessageId?: string;
    dispatchSource?: string;
  };
}

export interface CreateTaskResponse {
  taskId: string;
  status: 'pending';
  sessionId: string;
  strategy?: 'simple' | 'workflow';
  estimatedDuration?: number;
  createdAt: string;
}

export interface ListTasksRequest {
  sessionId?: string;
  sourceMessageId?: string;
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
  result?: unknown;
  errors?: TaskError[];
  metadata?: Record<string, unknown>;
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
  strategy?: 'simple' | 'workflow';
  estimatedDuration?: number;
  planning?: {
    source: 'heuristic' | 'llm';
    reason: string;
    analysis: {
      complexity: 'simple' | 'moderate' | 'complex';
      needsBrowser: boolean;
      needsNotification: boolean;
      needsMultipleSteps: boolean;
      needsParallel: boolean;
      detectedUrl?: string;
      detectedUrls?: string[];
    };
    model?: string;
    diagnostics?: {
      llmAttempted: boolean;
      llmAttempts: number;
      llmErrors: string[];
      llmTimeoutMs?: number;
      llmSkippedReason?: string;
      fallbackUsed?: 'heuristic-preview';
      fallbackReason?: string;
    };
    workflowDsl?: WorkflowDSL;
  };
  message?: string;
}

// 任务完成通知接口
export interface TaskCompletionNotification {
  taskId: string;
  status: TaskStatus.COMPLETED | TaskStatus.FAILED;
  result?: unknown;
  errors?: TaskError[];
}

export interface NotifyTaskCompletionRequest {
  sessionId: string;
  notification: TaskCompletionNotification;
}

export interface NotifyTaskCompletionResponse {
  success: boolean;
}
