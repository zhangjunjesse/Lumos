import type { ChatSession } from '@/types';
import { MAIN_AGENT_SESSION_MARKER } from '@/lib/chat/session-entry';
import { TaskStatus, type Task } from '../types';

const mockCreateSession = jest.fn();
const mockGetSession = jest.fn();
const mockAddMessage = jest.fn();
const mockCreateTaskInDb = jest.fn();
const mockGetTaskFromDb = jest.fn();
const mockGetTasksFromDb = jest.fn();
const mockUpdateTaskInDb = jest.fn();
const mockAcceptTask = jest.fn();
const mockCancelAcceptedTask = jest.fn();
const mockSyncMessageToFeishu = jest.fn();
const mockGetWorkflowProjection = jest.fn();

jest.mock('@/lib/db', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  addMessage: (...args: unknown[]) => mockAddMessage(...args),
}));

jest.mock('../db', () => ({
  initTaskManagementTables: jest.fn(),
  createTaskInDb: (...args: unknown[]) => mockCreateTaskInDb(...args),
  getTaskFromDb: (...args: unknown[]) => mockGetTaskFromDb(...args),
  getTasksFromDb: (...args: unknown[]) => mockGetTasksFromDb(...args),
  updateTaskInDb: (...args: unknown[]) => mockUpdateTaskInDb(...args),
}));

jest.mock('@/lib/scheduling', () => ({
  acceptTask: (...args: unknown[]) => mockAcceptTask(...args),
  cancelAcceptedTask: (...args: unknown[]) => mockCancelAcceptedTask(...args),
}));

jest.mock('@/lib/bridge/sync-helper', () => ({
  syncMessageToFeishu: (...args: unknown[]) => mockSyncMessageToFeishu(...args),
}));

jest.mock('@/lib/workflow/projection', () => ({
  getWorkflowProjection: (...args: unknown[]) => mockGetWorkflowProjection(...args),
}));

function buildSession(id: string): ChatSession {
  return {
    id,
    title: 'Workflow Center',
    created_at: '2026-03-21 10:00:00',
    updated_at: '2026-03-21 10:00:00',
    model: '',
    requested_model: '',
    resolved_model: '',
    system_prompt: '',
    working_directory: process.cwd(),
    sdk_session_id: '',
    project_name: '202-main-agent-team-foundation',
    provider_name: '',
    provider_id: '',
    status: 'active',
    mode: 'code',
    sdk_cwd: process.cwd(),
    folder: '',
    runtime_status: 'idle',
    runtime_updated_at: '2026-03-21 10:00:00',
    runtime_error: '',
  };
}

describe('task-management createTask', () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreateSession.mockReset();
    mockGetSession.mockReset();
    mockAddMessage.mockReset();
    mockCreateTaskInDb.mockReset();
    mockGetTaskFromDb.mockReset();
    mockGetTasksFromDb.mockReset();
    mockUpdateTaskInDb.mockReset();
    mockAcceptTask.mockReset();
    mockCancelAcceptedTask.mockReset();
    mockSyncMessageToFeishu.mockReset();
    mockGetWorkflowProjection.mockReset();

    mockAcceptTask.mockReturnValue({
      accepted: true,
      strategy: 'simple',
      estimatedDuration: 30,
      planning: {
        source: 'heuristic',
        reason: 'Task is narrow enough for a single direct execution.',
        analysis: {
          complexity: 'simple',
          needsBrowser: false,
          needsNotification: false,
          needsMultipleSteps: false,
          needsParallel: false,
        },
      },
      message: 'accepted',
    });
    mockAddMessage.mockReturnValue({ id: 'msg-task-notify-001' });
    mockSyncMessageToFeishu.mockResolvedValue({ ok: true });
    mockGetWorkflowProjection.mockReturnValue(null);
  });

  test('reuses an existing session when sessionId is valid', async () => {
    mockGetSession.mockReturnValue(buildSession('session-existing-001'));

    const { createTask } = await import('../api');
    const result = createTask({
      taskSummary: '输出一句简短摘要',
      requirements: ['一句话即可'],
      context: {
        sessionId: 'session-existing-001',
        relevantMessages: [],
      },
    });

    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockCreateTaskInDb).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-existing-001',
      } as Partial<Task>),
    );
    expect(result.sessionId).toBe('session-existing-001');
  });

  test('persists source message linkage when createTask receives main-agent context', async () => {
    mockGetSession.mockReturnValue(buildSession('session-existing-001'));

    const { createTask } = await import('../api');
    createTask({
      taskSummary: '整理主对话触发的任务链路',
      requirements: ['记录来源消息', '后续可回查'],
      context: {
        sessionId: 'session-existing-001',
        relevantMessages: ['用户要求从主 agent 对话直接下发任务。'],
        sourceMessageId: 'msg-user-001',
        dispatchSource: 'main_agent_chat',
      },
    });

    expect(mockCreateTaskInDb).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-existing-001',
        sourceMessageId: 'msg-user-001',
        metadata: expect.objectContaining({
          dispatch: expect.objectContaining({
            source: 'main_agent_chat',
            sourceMessageId: 'msg-user-001',
          }),
        }),
      } as Partial<Task>),
    );
  });

  test('creates a main-agent dispatch message and back-links the task to that assistant message', async () => {
    mockGetSession.mockReturnValue(buildSession('session-existing-001'));
    mockGetTaskFromDb.mockReturnValue({
      id: 'task_dispatch_001',
      sessionId: 'session-existing-001',
      sourceMessageId: 'msg-user-002',
      summary: '实现用户管理系统',
      requirements: ['支持创建用户', '支持删除用户'],
      status: TaskStatus.PENDING,
      progress: 0,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
      metadata: {
        dispatch: {
          source: 'main_agent_chat',
          sourceMessageId: 'msg-user-002',
        },
      },
    } satisfies Task);
    mockCreateTaskInDb.mockImplementation((task: Task) => {
      mockGetTaskFromDb.mockReturnValue(task);
    });
    mockAddMessage.mockReturnValue({ id: 'msg-assistant-dispatch-001' });

    const { dispatchMainAgentTask } = await import('../api');
    const result = dispatchMainAgentTask({
      sessionId: 'session-existing-001',
      sourceMessageId: 'msg-user-002',
      taskSummary: '实现用户管理系统',
      requirements: ['支持创建用户', '支持删除用户'],
      relevantMessages: ['用户要求主 agent 不要自己做，直接下发任务。'],
    });

    expect(result.assistantMessageId).toBe('msg-assistant-dispatch-001');
    expect(result.assistantMessage).toContain('我已经把这件事作为任务交给任务系统处理了');
    expect(mockAddMessage).toHaveBeenCalledWith(
      'session-existing-001',
      'assistant',
      expect.stringContaining('实现用户管理系统'),
      null,
    );
    expect(mockUpdateTaskInDb).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        sourceAssistantMessageId: 'msg-assistant-dispatch-001',
        metadata: expect.objectContaining({
          dispatch: expect.objectContaining({
            source: 'main_agent_chat',
            sourceMessageId: 'msg-user-002',
            assistantMessageId: 'msg-assistant-dispatch-001',
          }),
        }),
      }),
    );
  });

  test('creates a workflow session when provided sessionId does not exist', async () => {
    mockGetSession.mockReturnValue(undefined);
    mockCreateSession.mockReturnValue(buildSession('session-created-001'));

    const { createTask } = await import('../api');
    const result = createTask({
      taskSummary: '输出一句简短摘要',
      requirements: ['一句话即可'],
      context: {
        sessionId: 'workflow-center',
        relevantMessages: [],
      },
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      'Workflow Center',
      '',
      MAIN_AGENT_SESSION_MARKER,
      process.cwd(),
      'code',
    );
    expect(mockCreateTaskInDb).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-created-001',
      } as Partial<Task>),
    );
    expect(result.sessionId).toBe('session-created-001');
  });

  test('writes exact browser screenshot path into the completion message', async () => {
    const task = {
      id: 'task-browser-001',
      sessionId: 'session-existing-001',
      summary: '打开 https://example.com 并截图',
      requirements: ['打开页面', '截图'],
      status: TaskStatus.RUNNING,
      progress: 50,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
      metadata: {},
    } satisfies Partial<Task>;

    mockGetTaskFromDb.mockReturnValue(task);

    const screenshotPath = '/Users/zhangjun/.lumos/workflow-browser-runs/a73aa2f3d9f/screenshots/capture.png';
    const { updateTaskStatus } = await import('../api');
    updateTaskStatus({
      taskId: 'task-browser-001',
      status: TaskStatus.COMPLETED,
      progress: 100,
      result: {
        workflowId: 'workflow-browser-001',
        outputs: {
          open: {
            success: true,
            output: {
              action: 'navigate',
              url: 'https://example.com',
              title: 'Example Domain',
            },
          },
          capture: {
            success: true,
            output: {
              action: 'screenshot',
              url: 'https://example.com',
              title: 'Example Domain',
              screenshotPath,
              screenshotBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAUA',
            },
          },
          notify: {
            success: true,
            output: {
              message: '任务已完成：打开 https://example.com 并截图',
              channel: 'system',
            },
          },
        },
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(mockAddMessage).toHaveBeenCalledWith(
      'session-existing-001',
      'assistant',
      expect.stringContaining(`\`${screenshotPath}\``),
      null,
    );
    expect(mockAddMessage).toHaveBeenCalledWith(
      'session-existing-001',
      'assistant',
      expect.stringContaining('成功打开了 https://example.com，页面标题为 "Example Domain"，并已保存截图。'),
      null,
    );
    expect(mockAddMessage).not.toHaveBeenCalledWith(
      'session-existing-001',
      'assistant',
      expect.stringContaining('a73aa2f3...'),
      null,
    );
  });

  test('avoids repeating the full aggregate report when notify already contains the same body', async () => {
    const task = {
      id: 'task-mixed-001',
      sessionId: 'session-existing-001',
      summary: '先整理比较维度，再并行打开三个页面并汇总通知',
      requirements: ['先分析', '并行截图', '汇总后通知'],
      status: TaskStatus.RUNNING,
      progress: 90,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
      metadata: {},
    } satisfies Partial<Task>;

    mockGetTaskFromDb.mockReturnValue(task);

    const finalReport = [
      '## 多页面并行访问汇总报告',
      '',
      '### 最终综合结论',
      '',
      '三个页面均已成功访问并截图。',
    ].join('\n');

    const { updateTaskStatus } = await import('../api');
    updateTaskStatus({
      taskId: 'task-mixed-001',
      status: TaskStatus.COMPLETED,
      progress: 100,
      result: {
        workflowId: 'workflow-mixed-001',
        outputs: {
          aggregate: {
            success: true,
            output: {
              summary: finalReport,
            },
          },
          notify: {
            success: true,
            output: {
              message: finalReport,
              channel: 'system',
              sessionId: 'session-existing-001',
            },
          },
        },
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(mockAddMessage).toHaveBeenCalledWith(
      'session-existing-001',
      'assistant',
      expect.stringContaining('完整结果已通过最终通知发送到当前会话，这里不再重复展开全文。'),
      null,
    );
    expect(mockAddMessage).not.toHaveBeenCalledWith(
      'session-existing-001',
      'assistant',
      expect.stringContaining(finalReport),
      null,
    );
  });

  test('merges workflow projection runtime details into task detail response', async () => {
    mockGetTaskFromDb.mockReturnValue({
      id: 'task-runtime-001',
      sessionId: 'session-existing-001',
      summary: '运行态详情验收',
      requirements: ['展示当前步骤', '展示失败或取消原因'],
      status: TaskStatus.RUNNING,
      progress: 56,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
      startedAt: new Date('2026-03-21T10:01:00.000Z'),
      metadata: {
        workflow: {
          workflowId: 'wf-runtime-001',
          currentAgentRole: 'researcher',
          simpleExecutionId: 'simple-task-runtime-001',
        },
        cancelReason: 'user-requested-from-ui',
      },
      errors: [{
        code: 'LEGACY_ERROR',
        message: 'legacy failure summary',
      }],
    } satisfies Partial<Task>);

    mockGetWorkflowProjection.mockReturnValue({
      workflowId: 'wf-runtime-001',
      taskId: 'task-runtime-001',
      workflowName: 'runtime-check',
      workflowVersion: 'dsl-v1-runtime-check',
      status: 'running',
      progress: 67,
      currentStep: 'browse_2',
      completedSteps: ['analyze', 'browse_1'],
      runningSteps: ['browse_2'],
      skippedSteps: ['notify'],
      stepIds: ['analyze', 'browse_1', 'browse_2', 'notify'],
      result: undefined,
      error: undefined,
      startedAt: '2026-03-21T10:01:02.000Z',
      completedAt: undefined,
      updatedAt: '2026-03-21T10:02:40.000Z',
    });

    const { getTaskDetail } = await import('../api');
    const detail = getTaskDetail({ taskId: 'task-runtime-001' });

    expect(detail.task.metadata?.workflow).toMatchObject({
      workflowId: 'wf-runtime-001',
      status: 'running',
      progress: 67,
      currentStep: 'browse_2',
      currentAgentRole: 'researcher',
      completedSteps: ['analyze', 'browse_1'],
      runningSteps: ['browse_2'],
      skippedSteps: ['notify'],
      startedAt: '2026-03-21T10:01:02.000Z',
      updatedAt: '2026-03-21T10:02:40.000Z',
      workflowName: 'runtime-check',
      workflowVersion: 'dsl-v1-runtime-check',
      simpleExecutionId: 'simple-task-runtime-001',
      cancelReason: 'user-requested-from-ui',
    });
  });

  test('finalizeMainAgentTaskDispatch links created task back to source and assistant messages', async () => {
    mockGetTaskFromDb.mockReturnValue({
      id: 'task-linked-001',
      sessionId: 'session-existing-001',
      sourceMessageId: undefined,
      summary: '主对话创建的任务',
      requirements: ['创建任务'],
      status: TaskStatus.PENDING,
      progress: 0,
      createdAt: new Date('2026-03-21T10:00:00.000Z'),
      metadata: {},
    } satisfies Partial<Task>);

    const { finalizeMainAgentTaskDispatch } = await import('../api');
    const linkedTaskIds = finalizeMainAgentTaskDispatch({
      sessionId: 'session-existing-001',
      sourceMessageId: 'msg-user-123',
      assistantMessageId: 'msg-assistant-456',
      assistantContent: JSON.stringify([
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'mcp__task-management__createTask',
          input: {
            taskSummary: '主对话创建的任务',
            requirements: ['创建任务'],
            sessionId: 'session-existing-001',
          },
        },
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: JSON.stringify({
            taskId: 'task-linked-001',
            status: 'pending',
            sessionId: 'session-existing-001',
            createdAt: '2026-03-21T10:00:00.000Z',
          }),
        },
      ]),
    });

    expect(linkedTaskIds).toEqual(['task-linked-001']);
    expect(mockUpdateTaskInDb).toHaveBeenCalledWith(
      'task-linked-001',
      expect.objectContaining({
        sourceMessageId: 'msg-user-123',
        sourceAssistantMessageId: 'msg-assistant-456',
        metadata: expect.objectContaining({
          dispatch: expect.objectContaining({
            source: 'main_agent_chat',
            sourceMessageId: 'msg-user-123',
            assistantMessageId: 'msg-assistant-456',
          }),
        }),
      }),
    );
  });
});
