// Task Management API 实现（真实数据库版本）

import crypto from 'crypto';
import { addMessage, createSession, getSession } from '@/lib/db';
import { syncMessageToFeishu } from '@/lib/bridge/sync-helper';
import { withSessionEntryMarker } from '@/lib/chat/session-entry';
import { getWorkflowProjection } from '@/lib/workflow/projection';
import { parseMessageContent } from '@/types';
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
  TaskCompletionNotification,
} from './types';
import {
  initTaskManagementTables,
  createTaskInDb,
  getTaskFromDb,
  getTasksFromDb,
  updateTaskInDb,
} from './db';
import { acceptTask, cancelAcceptedTask } from '@/lib/scheduling';

// 初始化数据库表
initTaskManagementTables();

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === TaskStatus.PENDING
    || value === TaskStatus.RUNNING
    || value === TaskStatus.COMPLETED
    || value === TaskStatus.FAILED
    || value === TaskStatus.CANCELLED;
}

function isAbsoluteFilePath(value: string): boolean {
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value);
}

function hasLikelyFileExtension(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop() || '';
  return /\.[a-zA-Z0-9]{1,16}$/.test(fileName);
}

function cleanAbsoluteFilePath(value: string): string | null {
  const trimmed = value.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!trimmed) {
    return null;
  }
  if (!isAbsoluteFilePath(trimmed) || !hasLikelyFileExtension(trimmed)) {
    return null;
  }
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    return null;
  }
  return trimmed;
}

function extractPreferredOutputText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ['summary', 'message', 'result', 'content', 'text']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function summarizeBrowserOutput(output: JsonRecord): string | null {
  const action = typeof output.action === 'string' ? output.action : '';
  const url = typeof output.url === 'string' ? output.url : '';
  const title = typeof output.title === 'string' ? output.title : '';

  if (action === 'navigate') {
    if (url && title) {
      return `成功打开了 ${url}，页面标题为 "${title}"。`;
    }
    if (url) {
      return `成功打开了 ${url}。`;
    }
    return '浏览器页面已成功打开。';
  }

  if (action === 'screenshot') {
    if (url && title) {
      return `成功打开了 ${url}，页面标题为 "${title}"，并已保存截图。`;
    }
    if (url) {
      return `已保存 ${url} 的页面截图。`;
    }
    return '已保存页面截图。';
  }

  if (action === 'click') {
    return '浏览器点击操作已完成。';
  }

  if (action === 'fill') {
    return '浏览器填写操作已完成。';
  }

  return null;
}

function summarizeStepOutput(output: unknown, options?: { allowNotification?: boolean }): string | null {
  if (!isRecord(output)) {
    return extractPreferredOutputText(output);
  }

  const browserSummary = summarizeBrowserOutput(output);
  if (browserSummary) {
    return browserSummary;
  }

  const channel = typeof output.channel === 'string' ? output.channel : '';
  const message = typeof output.message === 'string' ? output.message.trim() : '';
  if (channel && message) {
    return options?.allowNotification ? `已发送通知：${message}` : null;
  }

  return extractPreferredOutputText(output);
}

function collectAttachmentPaths(value: unknown, found = new Set<string>(), seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') {
    const cleaned = cleanAbsoluteFilePath(value);
    if (cleaned) {
      found.add(cleaned);
    }
    return Array.from(found);
  }

  if (!value || typeof value !== 'object') {
    return Array.from(found);
  }

  if (seen.has(value)) {
    return Array.from(found);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAttachmentPaths(item, found, seen);
      if (found.size >= 8) {
        break;
      }
    }
    return Array.from(found);
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key.toLowerCase().includes('base64')) {
      continue;
    }
    collectAttachmentPaths(nested, found, seen);
    if (found.size >= 8) {
      break;
    }
  }

  return Array.from(found);
}

function getOutputSnapshotsInReverse(result: unknown): Array<{ output?: unknown; error?: string }> {
  if (!isRecord(result) || !isRecord(result.outputs)) {
    return [];
  }

  const snapshots = Object.values(result.outputs)
    .filter((value) => isRecord(value))
    .map((value) => value as { output?: unknown; error?: string });

  return snapshots.reverse();
}

function normalizeSummaryText(value: string): string {
  return value.trim().replace(/\r\n/g, '\n');
}

function hasDuplicatedNotificationSummary(result: unknown): boolean {
  const snapshots = getOutputSnapshotsInReverse(result);
  if (snapshots.length === 0) {
    return false;
  }

  const notificationMessages = snapshots
    .map((snapshot) => snapshot.output)
    .filter((output): output is JsonRecord => isRecord(output))
    .map((output) => {
      const channel = typeof output.channel === 'string' ? output.channel : '';
      const message = typeof output.message === 'string' ? output.message.trim() : '';
      return channel && message ? normalizeSummaryText(message) : null;
    })
    .filter((message): message is string => Boolean(message));

  if (notificationMessages.length === 0) {
    return false;
  }

  const nonNotificationSummaries = snapshots
    .map((snapshot) => summarizeStepOutput(snapshot.output, { allowNotification: false }))
    .filter((summary): summary is string => Boolean(summary))
    .map(normalizeSummaryText);

  if (nonNotificationSummaries.length === 0) {
    return false;
  }

  return notificationMessages.some((message) => nonNotificationSummaries.includes(message));
}

function extractTaskResultSummary(result: unknown): string | null {
  const snapshots = getOutputSnapshotsInReverse(result);
  for (const allowNotification of [false, true]) {
    for (const snapshot of snapshots) {
      const summary = summarizeStepOutput(snapshot.output, { allowNotification });
      if (summary) {
        return summary;
      }
      if (snapshot.error?.trim()) {
        return snapshot.error.trim();
      }
    }
  }

  return summarizeStepOutput(result, { allowNotification: true });
}

function buildTaskCompletionMessage(
  task: Task,
  notification: TaskCompletionNotification,
): string {
  const statusText = notification.status === TaskStatus.COMPLETED ? '已完成' : '失败';
  const lines = [
    `[系统通知] 任务${statusText}`,
    '',
    `任务：${task.summary}`,
    `状态：${statusText}`,
  ];

  const resultSummary = extractTaskResultSummary(notification.result);
  if (resultSummary) {
    const completionSummary = hasDuplicatedNotificationSummary(notification.result)
      ? '完整结果已通过最终通知发送到当前会话，这里不再重复展开全文。'
      : resultSummary;
    lines.push('', '结果摘要：', completionSummary);
  }

  const attachmentPaths = collectAttachmentPaths(notification.result);
  if (attachmentPaths.length > 0) {
    lines.push('', '相关文件：');
    for (const attachmentPath of attachmentPaths) {
      lines.push(`\`${attachmentPath}\``);
    }
  }

  const errorMessages = (notification.errors || [])
    .map((error: { message?: string }) => error.message?.trim())
    .filter((message: string | undefined): message is string => Boolean(message));
  if (errorMessages.length > 0) {
    lines.push('', '错误信息：');
    for (const errorMessage of errorMessages) {
      lines.push(`- ${errorMessage}`);
    }
  }

  return lines.join('\n');
}

// 验证任务描述格式
function validateTaskSummary(summary: string): { valid: boolean; error?: string } {
  if (summary.includes('帮我') || summary.includes('我想')) {
    return { valid: false, error: '任务描述不应包含第一人称，请使用第三人称描述' };
  }
  return { valid: true };
}

function isTaskManagementCreateTaskTool(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized.includes('createtask')) {
    return false;
  }
  return (
    normalized === 'createtask'
    || normalized.includes('task-management')
    || normalized.includes('task_management')
    || normalized.includes('taskmanagement')
  );
}

function tryParseJsonRecord(value: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractTaskIdFromToolResultContent(content: string): string | null {
  const parsed = tryParseJsonRecord(content);
  if (!parsed) {
    return null;
  }

  if (typeof parsed.taskId === 'string' && parsed.taskId.trim()) {
    return parsed.taskId.trim();
  }

  if (Array.isArray(parsed.content)) {
    for (const item of parsed.content) {
      if (!isRecord(item) || typeof item.text !== 'string') {
        continue;
      }
      const nestedTaskId = extractTaskIdFromToolResultContent(item.text);
      if (nestedTaskId) {
        return nestedTaskId;
      }
    }
  }

  return null;
}

function extractCreatedTaskIdsFromAssistantContent(content: string): string[] {
  const blocks = parseMessageContent(content);
  const createTaskUseIds = new Set<string>();
  const taskIds: string[] = [];

  for (const block of blocks) {
    if (block.type === 'tool_use' && isTaskManagementCreateTaskTool(block.name)) {
      createTaskUseIds.add(block.id);
    }
  }

  for (const block of blocks) {
    if (block.type !== 'tool_result' || block.is_error || !createTaskUseIds.has(block.tool_use_id)) {
      continue;
    }
    const taskId = extractTaskIdFromToolResultContent(block.content);
    if (taskId && !taskIds.includes(taskId)) {
      taskIds.push(taskId);
    }
  }

  return taskIds;
}

function resolveTaskSessionId(request: CreateTaskRequest): string {
  const requestedSessionId = request.context.sessionId.trim();
  if (requestedSessionId) {
    const existingSession = getSession(requestedSessionId);
    if (existingSession) {
      return existingSession.id;
    }
  }

  const session = createSession(
    'Workflow Center',
    '',
    withSessionEntryMarker('', 'main-agent'),
    process.cwd(),
    'code',
  );

  return session.id;
}

// 创建任务
export function createTask(request: CreateTaskRequest): CreateTaskResponse {
  const validation = validateTaskSummary(request.taskSummary);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const sessionId = resolveTaskSessionId(request);
  const sourceMessageId = request.context.sourceMessageId?.trim() || undefined;
  const sourceAssistantMessageId = request.context.sourceAssistantMessageId?.trim() || undefined;
  const dispatchSource = request.context.dispatchSource?.trim() || undefined;

  const task: Task = {
    id: `task_${crypto.randomBytes(8).toString('hex')}`,
    sessionId,
    sourceMessageId,
    sourceAssistantMessageId,
    summary: request.taskSummary,
    requirements: request.requirements,
    status: TaskStatus.PENDING,
    progress: 0,
    createdAt: new Date(),
    metadata: {
      relevantMessages: request.context.relevantMessages,
      ...(sourceMessageId || sourceAssistantMessageId || dispatchSource
        ? {
            dispatch: {
              source: dispatchSource || 'api',
              ...(sourceMessageId ? { sourceMessageId } : {}),
              ...(sourceAssistantMessageId ? { assistantMessageId: sourceAssistantMessageId } : {}),
            },
          }
        : {}),
    },
  };

  // 保存到数据库
  createTaskInDb(task);

  // 提交给 Scheduling Layer
  const submitResult = submitTask({ taskId: task.id, task });
  if (!submitResult.accepted) {
    throw new Error('Scheduling Layer rejected task: ' + submitResult.message);
  }

  const schedulingMetadata = {
    accepted: true,
    strategy: submitResult.strategy,
    message: submitResult.message,
    estimatedDurationSeconds: submitResult.estimatedDuration,
    planningPending: !submitResult.planning,
    generator: submitResult.planning
      ? (submitResult.planning.source === 'llm' ? 'llm-planner' : 'heuristic-planner')
      : 'llm-planner',
    planner: submitResult.planning
      ? {
          source: submitResult.planning.source,
          reason: submitResult.planning.reason,
          analysis: submitResult.planning.analysis,
          model: submitResult.planning.model,
          diagnostics: submitResult.planning.diagnostics,
        }
      : undefined,
    workflowDsl: submitResult.planning?.workflowDsl,
  };

  updateTaskInDb(task.id, {
    estimatedDuration: submitResult.estimatedDuration,
    metadata: {
      ...task.metadata,
      scheduling: schedulingMetadata,
    },
  });

  return {
    taskId: task.id,
    status: 'pending',
    sessionId,
    strategy: submitResult.strategy,
    estimatedDuration: submitResult.estimatedDuration,
    createdAt: task.createdAt.toISOString(),
  };
}

function formatEstimatedDurationLabel(seconds?: number): string | null {
  if (!seconds || seconds <= 0) {
    return null;
  }

  if (seconds < 60) {
    return `约 ${seconds} 秒`;
  }

  const minutes = Math.round(seconds / 60);
  return `约 ${minutes} 分钟`;
}

function buildMainAgentDispatchMessage(params: {
  summary: string;
  strategy?: 'simple' | 'workflow';
  estimatedDuration?: number;
}): string {
  const lines = [
    '我已经把这件事作为任务交给任务系统处理了。',
    '',
    `任务：${params.summary}`,
    `当前状态：已进入处理队列`,
  ];

  if (params.strategy) {
    lines.push(`处理方式：${params.strategy === 'workflow' ? '分步骤处理' : '直接处理'}`);
  }

  const estimatedDurationLabel = formatEstimatedDurationLabel(params.estimatedDuration);
  if (estimatedDurationLabel) {
    lines.push(`预计耗时：${estimatedDurationLabel}`);
  }

  lines.push('', '你可以继续聊天；完成后我会在当前对话里直接汇报结果。');
  return lines.join('\n');
}

export function dispatchMainAgentTask(params: {
  sessionId: string;
  sourceMessageId: string;
  taskSummary: string;
  requirements: string[];
  relevantMessages?: string[];
}) {
  const created = createTask({
    taskSummary: params.taskSummary,
    requirements: params.requirements,
    context: {
      sessionId: params.sessionId,
      relevantMessages: params.relevantMessages,
      sourceMessageId: params.sourceMessageId,
      dispatchSource: 'main_agent_chat',
    },
  });

  const assistantMessage = buildMainAgentDispatchMessage({
    summary: params.taskSummary,
    strategy: created.strategy,
    estimatedDuration: created.estimatedDuration,
  });
  const storedAssistantMessage = addMessage(created.sessionId, 'assistant', assistantMessage, null);
  const task = getTaskFromDb(created.taskId);
  const baseMetadata = isRecord(task?.metadata) ? { ...task.metadata } : {};
  const dispatchMetadata = isRecord(baseMetadata.dispatch) ? { ...baseMetadata.dispatch } : {};

  updateTaskInDb(created.taskId, {
    sourceAssistantMessageId: storedAssistantMessage.id,
    metadata: {
      ...baseMetadata,
      dispatch: {
        ...dispatchMetadata,
        source: typeof dispatchMetadata.source === 'string' && dispatchMetadata.source.trim()
          ? dispatchMetadata.source
          : 'main_agent_chat',
        sourceMessageId: params.sourceMessageId,
        assistantMessageId: storedAssistantMessage.id,
        assistantConfirmedAt: new Date().toISOString(),
      },
    },
  });

  syncMessageToFeishu(created.sessionId, 'assistant', assistantMessage).catch((error) => {
    console.error('[TaskManagement] Failed to sync dispatch message to Feishu:', error);
  });

  return {
    ...created,
    assistantMessageId: storedAssistantMessage.id,
    assistantMessage,
  };
}

// 查询任务列表
export function listTasks(request: ListTasksRequest): ListTasksResponse {
  const { tasks, total } = getTasksFromDb({
    sessionId: request.sessionId,
    sourceMessageId: request.sourceMessageId,
    status: request.status,
    limit: request.limit,
    offset: request.offset,
  });

  const summaries: TaskSummary[] = tasks.map(t => ({
    id: t.id,
    summary: t.summary,
    status: t.status,
    progress: t.progress,
    estimatedDuration: t.estimatedDuration,
    strategy: extractSchedulingStrategy(t),
    createdAt: t.createdAt.toISOString(),
  }));

  return { tasks: summaries, total };
}

export function finalizeMainAgentTaskDispatch(params: {
  sessionId: string;
  sourceMessageId: string;
  assistantMessageId: string;
  assistantContent: string;
}): string[] {
  const taskIds = extractCreatedTaskIdsFromAssistantContent(params.assistantContent);
  if (taskIds.length === 0) {
    return [];
  }

  const linkedTaskIds: string[] = [];
  const assistantConfirmedAt = new Date().toISOString();

  for (const taskId of taskIds) {
    const task = getTaskFromDb(taskId);
    if (!task || task.sessionId !== params.sessionId) {
      continue;
    }

    const baseMetadata = isRecord(task.metadata) ? { ...task.metadata } : {};
    const dispatchMetadata = isRecord(baseMetadata.dispatch) ? { ...baseMetadata.dispatch } : {};

    updateTaskInDb(taskId, {
      sourceMessageId: task.sourceMessageId || params.sourceMessageId,
      sourceAssistantMessageId: params.assistantMessageId,
      metadata: {
        ...baseMetadata,
        dispatch: {
          ...dispatchMetadata,
          source: typeof dispatchMetadata.source === 'string' && dispatchMetadata.source.trim()
            ? dispatchMetadata.source
            : 'main_agent_chat',
          sourceMessageId: task.sourceMessageId || params.sourceMessageId,
          assistantMessageId: params.assistantMessageId,
          assistantConfirmedAt,
        },
      },
    });
    linkedTaskIds.push(taskId);
  }

  return linkedTaskIds;
}

// 获取任务详情
export function getTaskDetail(request: GetTaskDetailRequest): GetTaskDetailResponse {
  const task = getTaskFromDb(request.taskId);
  if (!task) {
    throw new Error(`Task not found: ${request.taskId}`);
  }

  return {
    task: {
      ...task,
      metadata: enrichTaskMetadataWithRuntimeProjection(task),
    },
  };
}

// 取消任务
export async function cancelTask(request: CancelTaskRequest): Promise<CancelTaskResponse> {
  const task = getTaskFromDb(request.taskId);
  if (!task) {
    throw new Error(`Task not found: ${request.taskId}`);
  }

  if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED) {
    return {
      success: false,
      message: '任务已完成，无法取消',
    };
  }

  const workflowId = extractWorkflowId(task);
  const cancelResult = await cancelAcceptedTask(request.taskId, workflowId);
  if (!cancelResult.success) {
    return {
      success: false,
      message: cancelResult.message,
    };
  }

  updateTaskInDb(request.taskId, {
    status: TaskStatus.CANCELLED,
    completedAt: new Date(),
    metadata: {
      ...task.metadata,
      cancelReason: request.reason,
      workflow: {
        ...(typeof task.metadata?.workflow === 'object' && task.metadata.workflow !== null
          ? task.metadata.workflow
          : {}),
        workflowId,
        status: TaskStatus.CANCELLED,
      },
    },
  });

  return {
    success: true,
    message: cancelResult.message || '任务已取消',
  };
}

// 更新任务状态（由 Scheduling Layer 调用）
export function updateTaskStatus(request: UpdateTaskStatusRequest): UpdateTaskStatusResponse {
  const task = getTaskFromDb(request.taskId);
  if (!task) {
    throw new Error(`Task not found: ${request.taskId}`);
  }

  if (isTerminalTaskStatus(task.status) && request.status !== task.status) {
    return { success: true };
  }

  const updates: Partial<Task> = {
    status: request.status,
    progress: request.progress,
    result: request.result,
    errors: request.errors,
    metadata: request.metadata ? { ...task.metadata, ...request.metadata } : task.metadata,
  };

  // 设置时间戳
  if (request.status === TaskStatus.RUNNING && !task.startedAt) {
    updates.startedAt = new Date();
  }
  if (request.status === TaskStatus.COMPLETED || request.status === TaskStatus.FAILED) {
    updates.completedAt = new Date();
  }

  updateTaskInDb(request.taskId, updates);

  // 如果任务完成，触发通知
  if (request.status === TaskStatus.COMPLETED || request.status === TaskStatus.FAILED) {
    notifyTaskCompletion({
      sessionId: task.sessionId,
      notification: {
        taskId: request.taskId,
        status: request.status,
        result: request.result,
        errors: request.errors,
      },
    }).catch(err => {
      console.error('[TaskManagement] Failed to notify completion:', err);
    });
  }

  return { success: true };
}

// ==========================================
// Scheduling Layer 接口（本地适配实现）
// ==========================================

// 提交任务给 Scheduling Layer
function submitTask(request: SubmitTaskRequest): SubmitTaskResponse {
  console.log('[TaskManagement] Submitting task to Scheduling Layer:', request.taskId);

  return acceptTask(
    request,
    {
      onTaskStatusUpdate: (statusRequest) => {
        updateTaskStatus(statusRequest);
      },
    }
  );
}

// ==========================================
// 任务完成通知
// ==========================================

async function notifyTaskCompletion(
  request: NotifyTaskCompletionRequest
): Promise<NotifyTaskCompletionResponse> {
  console.log('[TaskManagement] Notifying task completion:', request.notification.taskId);

  try {
    const task = getTaskFromDb(request.notification.taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const content = buildTaskCompletionMessage(task, request.notification);
    addMessage(request.sessionId, 'assistant', content, null);
    syncMessageToFeishu(request.sessionId, 'assistant', content).catch((error) => {
      console.error('[TaskManagement] Failed to sync completion message to Feishu:', error);
    });

    return { success: true };
  } catch (error) {
    console.error('[TaskManagement] Failed to notify completion:', error);
    return { success: false };
  }
}

function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (
    status === TaskStatus.COMPLETED
    || status === TaskStatus.FAILED
    || status === TaskStatus.CANCELLED
  );
}

function extractWorkflowId(task: Task): string | undefined {
  const workflowValue = task.metadata?.workflow;
  const workflow = isRecord(workflowValue) ? workflowValue : null;
  if (!workflow) {
    return undefined;
  }

  return typeof workflow.workflowId === 'string' ? workflow.workflowId : undefined;
}

function extractSchedulingStrategy(task: Task): 'simple' | 'workflow' | undefined {
  const schedulingValue = task.metadata?.scheduling;
  const scheduling = isRecord(schedulingValue) ? schedulingValue : null;
  if (!scheduling) {
    return undefined;
  }

  return scheduling.strategy === 'simple' || scheduling.strategy === 'workflow'
    ? scheduling.strategy
    : undefined;
}

function enrichTaskMetadataWithRuntimeProjection(task: Task): Record<string, unknown> | undefined {
  const baseMetadata = isRecord(task.metadata) ? { ...task.metadata } : {};
  const workflowMetadata = isRecord(baseMetadata.workflow) ? { ...baseMetadata.workflow } : {};
  const workflowId = extractWorkflowId(task);
  const projection = workflowId ? getWorkflowProjection(workflowId) : null;

  const taskError = Array.isArray(task.errors) && task.errors.length > 0
    ? task.errors[0]
    : null;
  const projectionError = projection && isRecord(projection.error)
    ? projection.error
    : null;
  const cancelReason = typeof baseMetadata.cancelReason === 'string' && baseMetadata.cancelReason.trim()
    ? baseMetadata.cancelReason.trim()
    : undefined;

  const mergedWorkflow: Record<string, unknown> = {
    ...workflowMetadata,
    ...(workflowId ? { workflowId } : {}),
    status: (
      projection?.status
      ?? (isTaskStatus(workflowMetadata.status) ? workflowMetadata.status : undefined)
      ?? task.status
    ),
    progress: (
      typeof projection?.progress === 'number'
        ? projection.progress
        : (typeof workflowMetadata.progress === 'number' ? workflowMetadata.progress : task.progress)
    ) ?? 0,
    currentStep: (
      projection?.currentStep
      ?? (typeof workflowMetadata.currentStep === 'string' ? workflowMetadata.currentStep : undefined)
    ),
    currentAgentRole: typeof workflowMetadata.currentAgentRole === 'string'
      ? workflowMetadata.currentAgentRole
      : undefined,
    completedSteps: projection?.completedSteps
      ?? (Array.isArray(workflowMetadata.completedSteps) ? workflowMetadata.completedSteps : []),
    runningSteps: projection?.runningSteps ?? [],
    skippedSteps: projection?.skippedSteps ?? [],
    stepIds: projection?.stepIds ?? (Array.isArray(workflowMetadata.stepIds) ? workflowMetadata.stepIds : []),
    startedAt: projection?.startedAt
      ?? (typeof workflowMetadata.startedAt === 'string' ? workflowMetadata.startedAt : undefined)
      ?? task.startedAt?.toISOString(),
    completedAt: projection?.completedAt
      ?? (typeof workflowMetadata.completedAt === 'string' ? workflowMetadata.completedAt : undefined)
      ?? task.completedAt?.toISOString(),
    updatedAt: projection?.updatedAt
      ?? (typeof workflowMetadata.updatedAt === 'string' ? workflowMetadata.updatedAt : undefined),
    workflowName: projection?.workflowName
      ?? (typeof workflowMetadata.workflowName === 'string' ? workflowMetadata.workflowName : undefined),
    workflowVersion: projection?.workflowVersion
      ?? (typeof workflowMetadata.workflowVersion === 'string' ? workflowMetadata.workflowVersion : undefined),
    ...(typeof workflowMetadata.simpleExecutionId === 'string'
      ? { simpleExecutionId: workflowMetadata.simpleExecutionId }
      : {}),
    ...(typeof workflowMetadata.durationMs === 'number'
      ? { durationMs: workflowMetadata.durationMs }
      : {}),
    ...(cancelReason ? { cancelReason } : {}),
  };

  if (projectionError) {
    mergedWorkflow.error = projectionError;
  } else if (taskError) {
    mergedWorkflow.error = {
      code: taskError.code,
      message: taskError.message,
      ...(taskError.details !== undefined ? { details: taskError.details } : {}),
    };
  } else if (task.status === TaskStatus.CANCELLED) {
    mergedWorkflow.error = {
      code: 'TASK_CANCELLED',
      message: cancelReason || 'Cancelled by user',
    };
  }

  return {
    ...baseMetadata,
    workflow: mergedWorkflow,
  };
}
