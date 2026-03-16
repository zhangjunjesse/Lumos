// Task Management API 实现（使用Mock数据）

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
  try {
    // 动态导入 addMessage 避免循环依赖
    const { addMessage } = require('@/lib/db');

    const { taskId, status, result, errors } = request.notification;

    // 构造通知消息
    let message = `📋 **任务状态更新**\n\n`;
    message += `任务ID: \`${taskId}\`\n`;
    message += `状态: ${status === 'completed' ? '✅ 已完成' : '❌ 失败'}\n\n`;

    if (result) {
      message += `**执行结果:**\n${JSON.stringify(result, null, 2)}\n\n`;
    }

    if (errors && errors.length > 0) {
      message += `**错误信息:**\n`;
      errors.forEach((err, i) => {
        message += `${i + 1}. ${err}\n`;
      });
    }

    // 插入系统消息到会话
    addMessage(request.sessionId, 'user', `<!--source:task-management-->${message}`);

    console.log('[TaskManagement] Task completion notification sent to session:', request.sessionId);

    return { success: true };
  } catch (error) {
    console.error('[TaskManagement] Failed to notify task completion:', error);
    return { success: false };
  }
}
