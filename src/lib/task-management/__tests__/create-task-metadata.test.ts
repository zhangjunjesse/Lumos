import { TaskStatus, type Task } from '../types';

const mockInitTaskManagementTables = jest.fn();
const mockCreateTaskInDb = jest.fn();
const mockGetTaskFromDb = jest.fn();
const mockGetTasksFromDb = jest.fn();
const mockUpdateTaskInDb = jest.fn();
const mockAcceptTask = jest.fn();
const mockCancelAcceptedTask = jest.fn();
const mockGetSession = jest.fn();

jest.mock('../db', () => ({
  initTaskManagementTables: () => mockInitTaskManagementTables(),
  createTaskInDb: (...args: unknown[]) => mockCreateTaskInDb(...args),
  getTaskFromDb: (...args: unknown[]) => mockGetTaskFromDb(...args),
  getTasksFromDb: (...args: unknown[]) => mockGetTasksFromDb(...args),
  updateTaskInDb: (...args: unknown[]) => mockUpdateTaskInDb(...args),
}));

jest.mock('@/lib/scheduling', () => ({
  acceptTask: (...args: unknown[]) => mockAcceptTask(...args),
  cancelAcceptedTask: (...args: unknown[]) => mockCancelAcceptedTask(...args),
}));

jest.mock('@/lib/db', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  createSession: jest.fn(),
  addMessage: jest.fn(),
}));

import { createTask, listTasks } from '../api';

describe('task management scheduling metadata', () => {
  beforeEach(() => {
    mockInitTaskManagementTables.mockClear();
    mockCreateTaskInDb.mockReset();
    mockGetTaskFromDb.mockReset();
    mockGetTasksFromDb.mockReset();
    mockUpdateTaskInDb.mockReset();
    mockAcceptTask.mockReset();
    mockCancelAcceptedTask.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockReturnValue({
      id: 'session-task-test-001',
    });
  });

  test('createTask persists an accepted pending-llm scheduling state instead of heuristic preview data', () => {
    mockAcceptTask.mockReturnValue({
      accepted: true,
      message: 'Task accepted by Scheduling Layer and is waiting for LLM planning',
    });

    const result = createTask({
      taskSummary: '整理当前任务状态',
      requirements: ['输出简短结论'],
      context: {
        sessionId: 'session-task-test-001',
        relevantMessages: ['上一轮已经完成主链验证。'],
      },
    });

    expect(mockCreateTaskInDb).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.taskId,
        summary: '整理当前任务状态',
        status: TaskStatus.PENDING,
      }),
    );

    expect(mockAcceptTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: result.taskId,
        task: expect.objectContaining({
          id: result.taskId,
          summary: '整理当前任务状态',
        }),
      }),
      expect.any(Object),
    );

    expect(mockUpdateTaskInDb).toHaveBeenCalledWith(
      result.taskId,
      expect.objectContaining({
        estimatedDuration: undefined,
        metadata: expect.objectContaining({
          relevantMessages: ['上一轮已经完成主链验证。'],
          scheduling: expect.objectContaining({
            accepted: true,
            strategy: undefined,
            estimatedDurationSeconds: undefined,
            planningPending: true,
            generator: 'llm-planner',
            message: 'Task accepted by Scheduling Layer and is waiting for LLM planning',
            planner: undefined,
          }),
        }),
      }),
    );

    expect(result).toEqual({
      taskId: result.taskId,
      status: 'pending',
      sessionId: 'session-task-test-001',
      strategy: undefined,
      estimatedDuration: undefined,
      createdAt: result.createdAt,
    });
  });

  test('listTasks returns persisted scheduling strategy and estimated duration', () => {
    const task: Task = {
      id: 'task-task-test-002',
      sessionId: 'session-task-test-002',
      summary: '打开页面并截图',
      requirements: ['打开页面', '截图'],
      status: TaskStatus.RUNNING,
      progress: 50,
      createdAt: new Date('2026-03-20T10:00:00.000Z'),
      estimatedDuration: 180,
      metadata: {
        scheduling: {
          strategy: 'workflow',
        },
      },
    };

    mockGetTasksFromDb.mockReturnValue({
      tasks: [task],
      total: 1,
    });

    const result = listTasks({ limit: 20 });

    expect(result).toEqual({
      tasks: [
        {
          id: 'task-task-test-002',
          summary: '打开页面并截图',
          status: TaskStatus.RUNNING,
          progress: 50,
          estimatedDuration: 180,
          strategy: 'workflow',
          createdAt: '2026-03-20T10:00:00.000Z',
        },
      ],
      total: 1,
    });
  });
});
