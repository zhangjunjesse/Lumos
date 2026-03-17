// Task Management Mock 数据

import { Task, TaskStatus } from './types';

const mockTasks: Map<string, Task> = new Map();

export function getMockTask(taskId: string): Task | undefined {
  return mockTasks.get(taskId);
}

export function getAllMockTasks(): Task[] {
  return Array.from(mockTasks.values());
}

export function createMockTask(task: Omit<Task, 'id' | 'createdAt' | 'status'>): Task {
  const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const newTask: Task = {
    ...task,
    id,
    status: TaskStatus.PENDING,
    createdAt: new Date(),
  };
  mockTasks.set(id, newTask);
  return newTask;
}

export function updateMockTask(taskId: string, updates: Partial<Task>): Task | undefined {
  const task = mockTasks.get(taskId);
  if (!task) return undefined;

  const updatedTask = { ...task, ...updates };
  mockTasks.set(taskId, updatedTask);
  return updatedTask;
}

export function deleteMockTask(taskId: string): boolean {
  return mockTasks.delete(taskId);
}
