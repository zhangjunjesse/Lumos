// Task Management API 实现（使用Mock数据）

import type { ChatSession } from '@/types';
import {
  Task,
  TaskStatus,
  CreateTaskRequest,
  CreateTaskResponse,
  ListTasksRequest,
  ListTasksResponse,
  GetTaskDetailRequest,
  GetTaskDetailResponse,
  CancelTaskRequest,
  CancelTaskResponse,
  UpdateTaskStatusRequest,
  UpdateTaskStatusResponse,
  TaskSummary,
  SubmitTaskRequest,
  SubmitTaskResponse,
  NotifyTaskCompletionRequest,
  NotifyTaskCompletionResponse,
} from './types';
import {
  createMockTask,
  getMockTask,
  getAllMockTasks,
  updateMockTask,
} from './mock-data';

// 尝试向最新会话发送通知
async function tryNotifyLatestSession(prompt: string, originalSessionId: string) {
  try {
    const { getAllSessions } = require('@/lib/db');
    const sessions = getAllSessions() as ChatSession[];

    if (sessions.length === 0) {
      console.error('[TaskManagement] No sessions found');
      return;
    }

    // 按时间排序，获取最新会话
    const latestSession = sessions.sort((a: ChatSession, b: ChatSession) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];

    console.log('[TaskManagement] Trying latest session:', latestSession.id);

    const apiUrl = `http://127.0.0.1:${process.env.PORT || 3000}/api/chat`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        session_id: latestSession.id,
        content: prompt,
      }),
    });

    if (response.ok) {
      console.log('[TaskManagement] AI notification sent to latest session');
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }
    } else {
      console.error('[TaskManagement] Failed to notify latest session:', response.status);
    }
  } catch (error) {
    console.error('[TaskManagement] Error notifying latest session:', error);
  }
}

// 验证任务描述格式
function validateTaskSummary(summary: string): { valid: boolean; error?: string } {
  if (summary.includes('帮我') || summary.includes('我想')) {
    return { valid: false, error: '任务描述不应包含第一人称，请使用第三人称描述' };
  }
  return { valid: true };
}

// 创建任务
export function createTask(request: CreateTaskRequest): CreateTaskResponse {
  const validation = validateTaskSummary(request.taskSummary);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const task = createMockTask({
    sessionId: request.context.sessionId,
    summary: request.taskSummary,
    requirements: request.requirements,
    metadata: {
      relevantMessages: request.context.relevantMessages,
    },
  });

  // 提交给Scheduling Layer
  const submitResult = submitTask({ taskId: task.id, task });
  if (!submitResult.accepted) {
    throw new Error('Scheduling Layer rejected task: ' + submitResult.message);
  }

  return {
    taskId: task.id,
    status: 'pending',
    createdAt: task.createdAt.toISOString(),
  };
}

// 查询任务列表
export function listTasks(request: ListTasksRequest): ListTasksResponse {
  let tasks = getAllMockTasks();

  // 过滤
  if (request.sessionId) {
    tasks = tasks.filter(t => t.sessionId === request.sessionId);
  }
  if (request.status && request.status.length > 0) {
    tasks = tasks.filter(t => request.status!.includes(t.status));
  }

  // 排序（最新的在前）
  tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // 分页
  const offset = request.offset || 0;
  const limit = Math.min(request.limit || 20, 100);
  const paginatedTasks = tasks.slice(offset, offset + limit);

  const summaries: TaskSummary[] = paginatedTasks.map(t => ({
    id: t.id,
    summary: t.summary,
    status: t.status,
    progress: t.progress,
    createdAt: t.createdAt.toISOString(),
  }));

  return {
    tasks: summaries,
    total: tasks.length,
  };
}

// 获取任务详情
export function getTaskDetail(request: GetTaskDetailRequest): GetTaskDetailResponse {
  const task = getMockTask(request.taskId);
  if (!task) {
    throw new Error('任务不存在');
  }

  return { task };
}

// 取消任务
export function cancelTask(request: CancelTaskRequest): CancelTaskResponse {
  const task = getMockTask(request.taskId);
  if (!task) {
    throw new Error('任务不存在');
  }

  if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED) {
    throw new Error('任务已完成，无法取消');
  }

  updateMockTask(request.taskId, {
    status: TaskStatus.CANCELLED,
    completedAt: new Date(),
  });

  return {
    success: true,
    message: '任务已取消',
  };
}

// 更新任务状态（由Scheduling Layer调用）
export function updateTaskStatus(request: UpdateTaskStatusRequest): UpdateTaskStatusResponse {
  const task = getMockTask(request.taskId);
  if (!task) {
    throw new Error('任务不存在');
  }

  // 验证状态转换
  const validTransitions: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.PENDING]: [TaskStatus.RUNNING, TaskStatus.CANCELLED],
    [TaskStatus.RUNNING]: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED],
    [TaskStatus.COMPLETED]: [],
    [TaskStatus.FAILED]: [],
    [TaskStatus.CANCELLED]: [],
  };

  if (!validTransitions[task.status].includes(request.status)) {
    throw new Error(`状态转换不合法: ${task.status} -> ${request.status}`);
  }

  const updates: Partial<Task> = {
    status: request.status,
    progress: request.progress,
    result: request.result,
    errors: request.errors,
    metadata: { ...task.metadata, ...request.metadata },
  };

  if (request.status === TaskStatus.RUNNING && !task.startedAt) {
    updates.startedAt = new Date();
  }

  if ([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(request.status)) {
    updates.completedAt = new Date();
  }

  updateMockTask(request.taskId, updates);

  // 触发任务完成通知
  if (request.status === TaskStatus.COMPLETED || request.status === TaskStatus.FAILED) {
    notifyTaskCompletion({
      sessionId: task.sessionId,
      notification: {
        taskId: request.taskId,
        status: request.status,
        result: request.result,
        errors: request.errors,
      },
    });
  }

  return { success: true };
}

// 提交任务给Scheduling Layer（Mock实现）
export function submitTask(request: SubmitTaskRequest): SubmitTaskResponse {
  // Mock: 实际应该调用Scheduling Layer的API
  console.log('[TaskManagement] Submitting task to Scheduling Layer (mock):', request.taskId);

  // Mock: 假设总是接受任务
  return {
    accepted: true,
    message: 'Task accepted by Scheduling Layer (mock)',
  };
}

// 通知Main Agent任务完成
export function notifyTaskCompletion(request: NotifyTaskCompletionRequest): NotifyTaskCompletionResponse {
  const { taskId, status, result, errors } = request.notification;

  // 构造通知提示词（包裹在注释中，前端会过滤）
  let prompt = `<!--system-prompt-->\n[系统通知] 任务 ${taskId} 状态更新为 ${status}。`;
  if (result) {
    prompt += `\n执行结果: ${JSON.stringify(result)}`;
  }
  if (errors && errors.length > 0) {
    prompt += `\n错误: ${errors.join(', ')}`;
  }
  prompt += '\n\n请主动通知用户任务完成情况。\n<!--/system-prompt-->';

  const apiUrl = `http://127.0.0.1:${process.env.PORT || 3000}/api/chat`;

  // 尝试向原会话发送通知
  fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({
      session_id: request.sessionId,
      content: prompt,
    }),
  }).then(async response => {
    console.log('[TaskManagement] Chat API response status:', response.status);
    if (response.ok) {
      console.log('[TaskManagement] AI notification triggered for session:', request.sessionId);
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
          console.log('[TaskManagement] AI notification completed');
        } catch (err) {
          console.error('[TaskManagement] Error reading response stream:', err);
        }
      }
    } else {
      const errorText = await response.text();
      console.error('[TaskManagement] Chat API failed:', response.status, errorText);

      // 如果原会话不存在，尝试向最新会话发送通知
      if (response.status === 404) {
        console.log('[TaskManagement] Original session not found, trying latest session...');
        tryNotifyLatestSession(prompt, request.sessionId);
      }
    }
  }).catch(error => {
    console.error('[TaskManagement] Failed to trigger AI notification:', error);
  });

  return { success: true };
}
