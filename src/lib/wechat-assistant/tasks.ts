import { getSetting, setSetting } from '@/lib/db';

export type WeChatAssistantTaskId =
  | 'daily-summary'
  | 'important-alert'
  | 'todo-extract'
  | 'follow-up';

export interface WeChatAssistantTask {
  id: WeChatAssistantTaskId;
  title: string;
  description: string;
  enabled: boolean;
  schedule: string;
  builtin: true;
  lastRunAt: number | null;
  lastResult: string;
}

const SETTINGS_KEY = 'apps.wechat-assistant.tasks.v1';

const DEFAULT_TASKS: WeChatAssistantTask[] = [
  {
    id: 'daily-summary',
    title: '每日微信总结',
    description: '每天固定时间汇总全部微信消息，提炼重点、待办和需要回复的人。',
    enabled: false,
    schedule: '21:00',
    builtin: true,
    lastRunAt: null,
    lastResult: '尚未运行',
  },
  {
    id: 'important-alert',
    title: '重要消息提醒',
    description: '发现合同、付款、投诉、截止时间等高优先级消息时提醒。',
    enabled: false,
    schedule: '实时',
    builtin: true,
    lastRunAt: null,
    lastResult: '尚未运行',
  },
  {
    id: 'todo-extract',
    title: '微信待办提取',
    description: '从聊天里提取“需要处理、确认、回复、发送”的事项。',
    enabled: false,
    schedule: '18:00',
    builtin: true,
    lastRunAt: null,
    lastResult: '尚未运行',
  },
  {
    id: 'follow-up',
    title: '联系人跟进提醒',
    description: '识别长时间未回复、客户跟进和关键联系人遗漏。',
    enabled: false,
    schedule: '09:30',
    builtin: true,
    lastRunAt: null,
    lastResult: '尚未运行',
  },
];

export function listWeChatAssistantTasks(): WeChatAssistantTask[] {
  const stored = readStoredTasks();
  return DEFAULT_TASKS.map((task) => ({
    ...task,
    ...(stored[task.id] ?? {}),
    id: task.id,
    title: task.title,
    description: task.description,
    builtin: true,
  }));
}

export function updateWeChatAssistantTask(
  id: WeChatAssistantTaskId,
  patch: Partial<Pick<WeChatAssistantTask, 'enabled' | 'schedule' | 'lastRunAt' | 'lastResult'>>,
): WeChatAssistantTask[] {
  const tasks = listWeChatAssistantTasks();
  const next = tasks.map((task) => {
    if (task.id !== id) return task;
    return {
      ...task,
      ...patch,
      schedule: normalizeSchedule(patch.schedule ?? task.schedule),
    };
  });
  writeTasks(next);
  return next;
}

export function isWeChatAssistantTaskId(value: string): value is WeChatAssistantTaskId {
  return DEFAULT_TASKS.some((task) => task.id === value);
}

export function normalizeSchedule(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '21:00';
  if (trimmed === '实时') return trimmed;
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(trimmed);
  if (!match) return trimmed.slice(0, 24);
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2] ?? '0')));
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function readStoredTasks(): Record<string, Partial<WeChatAssistantTask>> {
  const raw = getSetting(SETTINGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, Partial<WeChatAssistantTask>>
      : {};
  } catch {
    return {};
  }
}

function writeTasks(tasks: WeChatAssistantTask[]): void {
  const payload = Object.fromEntries(
    tasks.map((task) => [
      task.id,
      {
        enabled: task.enabled,
        schedule: task.schedule,
        lastRunAt: task.lastRunAt,
        lastResult: task.lastResult,
      },
    ]),
  );
  setSetting(SETTINGS_KEY, JSON.stringify(payload));
}
