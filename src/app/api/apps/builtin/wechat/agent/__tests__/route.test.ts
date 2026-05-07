import { NextRequest } from 'next/server';

import type { Automation } from '@/components/apps/builtin/wechat/relations-types';
import type { WeChatTodo } from '@/lib/wechat-assistant/ai-types';

import { POST } from '../route';

const mockAutomations: Automation[] = [];
const mockTodos: WeChatTodo[] = [];
const mockSearchMessages = jest.fn();
const mockListTodos = jest.fn(() => mockTodos);
const mockAddManualTodo = jest.fn((input: {
  text: string;
  sourceWxid?: string | null;
  sourceDisplay?: string | null;
  involvedWxids?: string[];
  summary?: string | null;
  nextStep?: string | null;
  followupType?: string | null;
  byWhenText?: string | null;
  dueAt?: number | null;
  remindAt?: number | null;
}) => {
  const todo = todoItem(`todo-${mockTodos.length + 1}`, input.text, {
    summary: input.summary ?? null,
    nextStep: input.nextStep ?? null,
    byWhenText: input.byWhenText ?? null,
    dueAt: input.dueAt ?? null,
  });
  mockTodos.unshift(todo);
  return todo;
});
const mockSetTodoStatus = jest.fn((id: string, status: WeChatTodo['status']) => {
  const index = mockTodos.findIndex((item) => item.id === id);
  if (index < 0) return null;
  mockTodos[index] = { ...mockTodos[index]!, status };
  return mockTodos[index]!;
});

const mockUpdateWeChatAutomation = jest.fn(async (id: string, patch: Partial<Automation>) => {
  const index = mockAutomations.findIndex((item) => item.id === id);
  if (index < 0) return null;
  mockAutomations[index] = { ...mockAutomations[index]!, ...patch };
  return mockAutomations[index]!;
});

const mockDeleteWeChatAutomation = jest.fn(async (id: string) => {
  const index = mockAutomations.findIndex((item) => item.id === id);
  if (index < 0) return false;
  mockAutomations.splice(index, 1);
  return true;
});

const mockCreateWeChatAutomation = jest.fn(async (draft: Omit<Automation, 'id' | 'createdAt'>) => {
  const automation: Automation = {
    ...draft,
    id: `created-${mockAutomations.length + 1}`,
    createdAt: 1,
  };
  mockAutomations.unshift(automation);
  return automation;
});

const mockTriggerWeChatAutomation = jest.fn(async (id: string) => {
  return mockAutomations.find((item) => item.id === id) ?? null;
});

jest.mock('@/lib/wechat-assistant/automations', () => ({
  createWeChatAutomation: (...args: Parameters<typeof mockCreateWeChatAutomation>) =>
    mockCreateWeChatAutomation(...args),
  deleteWeChatAutomation: (...args: Parameters<typeof mockDeleteWeChatAutomation>) =>
    mockDeleteWeChatAutomation(...args),
  listWeChatAutomations: jest.fn(() => mockAutomations),
  triggerWeChatAutomation: (...args: Parameters<typeof mockTriggerWeChatAutomation>) =>
    mockTriggerWeChatAutomation(...args),
  updateWeChatAutomation: (...args: Parameters<typeof mockUpdateWeChatAutomation>) =>
    mockUpdateWeChatAutomation(...args),
}));

jest.mock('@/lib/wechat-assistant/mirror-store', () => ({
  searchMessages: (...args: unknown[]) => mockSearchMessages(...args),
}));

jest.mock('@/lib/wechat-assistant/db', () => ({
  addManualTodo: (...args: Parameters<typeof mockAddManualTodo>) => mockAddManualTodo(...args),
  listTodos: (...args: Parameters<typeof mockListTodos>) => mockListTodos(...args),
  setTodoStatus: (...args: Parameters<typeof mockSetTodoStatus>) => mockSetTodoStatus(...args),
}));

describe('wechat assistant agent route', () => {
  beforeEach(() => {
    mockAutomations.splice(0, mockAutomations.length);
    mockTodos.splice(0, mockTodos.length);
    mockSearchMessages.mockReset();
    mockSearchMessages.mockReturnValue([]);
    jest.clearAllMocks();
    mockListTodos.mockImplementation(() => mockTodos);
  });

  it('does not delete an arbitrary automation when multiple rules exist and the name is unclear', async () => {
    mockAutomations.push(
      automation('daily', '每日微信总结'),
      automation('project', '国信项目提醒'),
    );

    const res = await POST(makeReq('删除提醒'));
    const json = await res.json() as { reply: string; automations: Automation[] };

    expect(res.status).toBe(200);
    expect(mockDeleteWeChatAutomation).not.toHaveBeenCalled();
    expect(json.automations).toHaveLength(2);
    expect(json.reply).toContain('请带上自动化名称');
  });

  it('updates the named automation instead of falling back to the first rule', async () => {
    mockAutomations.push(
      automation('daily', '每日微信总结'),
      automation('project', '国信项目提醒'),
    );

    const res = await POST(makeReq('暂停 国信项目提醒'));
    const json = await res.json() as { reply: string; automations: Automation[] };

    expect(res.status).toBe(200);
    expect(mockUpdateWeChatAutomation).toHaveBeenCalledWith('project', { enabled: false });
    expect(mockAutomations.find((item) => item.id === 'daily')?.enabled).toBe(true);
    expect(mockAutomations.find((item) => item.id === 'project')?.enabled).toBe(false);
    expect(json.reply).toContain('国信项目提醒');
  });

  it('updates a named automation schedule from natural language', async () => {
    mockAutomations.push(
      automation('daily', '每日微信总结'),
      automation('project', '国信项目提醒'),
    );

    const res = await POST(makeReq('把国信项目提醒改成每天晚上 10 点'));
    const json = await res.json() as { reply: string };

    expect(res.status).toBe(200);
    expect(mockUpdateWeChatAutomation).toHaveBeenCalledWith('project', expect.objectContaining({
      kind: 'reminder_recurring',
      cron: '0 22 * * *',
      cronLabel: '每天 22:00',
    }));
    expect(mockAutomations.find((item) => item.id === 'daily')?.cron).toBe('0 21 * * *');
    expect(mockAutomations.find((item) => item.id === 'project')?.cron).toBe('0 22 * * *');
    expect(json.reply).toContain('时间：每天 22:00');
  });

  it('updates a named reminder message without changing its schedule', async () => {
    mockAutomations.push(
      automation('daily', '每日微信总结'),
      automation('project', '国信项目提醒'),
    );

    const res = await POST(makeReq('把国信项目提醒的提醒内容改成检查合同回款'));
    const json = await res.json() as { reply: string };
    const patch = mockUpdateWeChatAutomation.mock.calls[0]?.[1] as Partial<Automation>;

    expect(res.status).toBe(200);
    expect(mockUpdateWeChatAutomation).toHaveBeenCalledWith('project', expect.objectContaining({
      action: { kind: 'custom', messageTemplate: '检查合同回款' },
    }));
    expect(patch).not.toHaveProperty('cron');
    expect(mockAutomations.find((item) => item.id === 'project')?.cron).toBe('0 21 * * *');
    expect(json.reply).toContain('已更新');
  });

  it('updates the daily summary prompt while preserving the summary action kind', async () => {
    mockAutomations.push({
      ...automation('daily', '每日微信总结'),
      action: { kind: 'wechat_summary', messageTemplate: '汇总今天微信消息' },
    });

    const res = await POST(makeReq('把每日微信总结的总结要求改成只总结待办和未回复消息'));
    const patch = mockUpdateWeChatAutomation.mock.calls[0]?.[1] as Partial<Automation>;

    expect(res.status).toBe(200);
    expect(mockUpdateWeChatAutomation).toHaveBeenCalledWith('daily', expect.objectContaining({
      action: { kind: 'wechat_summary', messageTemplate: '只总结待办和未回复消息' },
    }));
    expect(patch).not.toHaveProperty('cron');
    expect(mockAutomations[0]?.action).toEqual({
      kind: 'wechat_summary',
      messageTemplate: '只总结待办和未回复消息',
    });
  });

  it('does not update an arbitrary automation when multiple rules exist and the name is unclear', async () => {
    mockAutomations.push(
      automation('daily', '每日微信总结'),
      automation('project', '国信项目提醒'),
    );

    const res = await POST(makeReq('把提醒改成每天 10 点'));
    const json = await res.json() as { reply: string };

    expect(res.status).toBe(200);
    expect(mockUpdateWeChatAutomation).not.toHaveBeenCalled();
    expect(json.reply).toContain('请带上自动化名称');
  });

  it('diagnoses a named failed automation', async () => {
    mockAutomations.push({
      ...automation('project', '国信项目提醒'),
      scheduleId: 'schedule-project',
      latestRunId: 'run-project',
      lastRunStatus: 'error',
      lastRunAt: new Date('2026-05-05T10:30:00Z').getTime(),
      lastRunError: '浏览器等待超时',
    });

    const res = await POST(makeReq('国信项目提醒为什么失败'));
    const json = await res.json() as { reply: string };

    expect(res.status).toBe(200);
    expect(json.reply).toContain('最近运行：失败');
    expect(json.reply).toContain('错误原因：浏览器等待超时');
    expect(json.reply).toContain('最新结果');
  });

  it('does not diagnose an arbitrary automation when multiple rules exist and the name is unclear', async () => {
    mockAutomations.push(
      automation('daily', '每日微信总结'),
      automation('project', '国信项目提醒'),
    );

    const res = await POST(makeReq('为什么失败'));
    const json = await res.json() as { reply: string };

    expect(res.status).toBe(200);
    expect(json.reply).toContain('请带上自动化名称');
  });

  it('allows a generic delete only when there is exactly one automation', async () => {
    mockAutomations.push(automation('project', '国信项目提醒'));

    const res = await POST(makeReq('删除提醒'));
    const json = await res.json() as { automations: Automation[] };

    expect(res.status).toBe(200);
    expect(mockDeleteWeChatAutomation).toHaveBeenCalledWith('project');
    expect(json.automations).toEqual([]);
  });

  it('creates instant summaries as manual-only automations before triggering them', async () => {
    const res = await POST(makeReq('现在总结一下微信消息'));
    const json = await res.json() as { reply: string; automations: Automation[] };

    expect(res.status).toBe(200);
    expect(mockCreateWeChatAutomation).toHaveBeenCalledWith(expect.objectContaining({
      name: '即时微信总结',
      enabled: false,
      action: expect.objectContaining({ kind: 'wechat_summary' }),
    }));
    expect(mockTriggerWeChatAutomation).toHaveBeenCalledWith('created-1');
    expect(json.reply).toContain('已触发');
    expect(json.automations[0]).toEqual(expect.objectContaining({
      name: '即时微信总结',
      enabled: false,
    }));
  });

  it('searches wechat messages from the assistant conversation', async () => {
    mockSearchMessages.mockReturnValue([{
      wxid: 'alice',
      display: 'Alice',
      isGroup: false,
      ts: 1_700_000_000,
      sender: 'them',
      content: '合同今天确认',
    }]);

    const res = await POST(makeReq('查一下微信里关于合同的消息'));
    const json = await res.json() as { reply: string; actions: Array<{ type: string; label: string; query?: string }> };

    expect(res.status).toBe(200);
    expect(mockSearchMessages).toHaveBeenCalledWith({
      query: '合同',
      scope: 'all',
      sinceTs: null,
      limit: 5,
    });
    expect(json.reply).toContain('找到 1 条');
    expect(json.reply).toContain('私聊「Alice」');
    expect(json.reply).toContain('合同今天确认');
    expect(json.actions).toContainEqual({ type: 'open_overview', label: '去概况页搜索', query: '合同' });
  });

  it('does not expose internal ids in assistant search replies', async () => {
    mockSearchMessages.mockReturnValue([{
      wxid: '45434442516@chatroom',
      display: '45434442516@chatroom',
      isGroup: true,
      ts: 1_700_000_000,
      sender: 'them',
      senderDisplay: '25984985930267888@openim',
      content: '25984985930267888@openim: 5.6语文作业 1、《写字书》语文园地五',
    }]);

    const res = await POST(makeReq('查一下微信里有没有 5.6语文作业'));
    const json = await res.json() as { reply: string };

    expect(res.status).toBe(200);
    expect(json.reply).toContain('群聊「微信群聊」群成员');
    expect(json.reply).toContain('5.6语文作业');
    expect(json.reply).not.toContain('45434442516');
    expect(json.reply).not.toContain('@chatroom');
    expect(json.reply).not.toContain('@openim');
  });

  it('reports no assistant search result with a product-facing hint', async () => {
    const res = await POST(makeReq('微信里有没有不存在的关键词'));
    const json = await res.json() as { reply: string };

    expect(res.status).toBe(200);
    expect(mockSearchMessages).toHaveBeenCalledWith(expect.objectContaining({
      query: '不存在的关键词',
    }));
    expect(json.reply).toContain('没有找到');
    expect(json.reply).toContain('扩大时间范围');
  });

  it('creates a manual followup task from the assistant conversation', async () => {
    const res = await POST(makeReq('新增跟进：整理客户问题清单'));
    const json = await res.json() as {
      reply: string;
      actions: Array<{ type: string; label: string; followupId?: string }>;
    };

    expect(res.status).toBe(200);
    expect(mockAddManualTodo).toHaveBeenCalledWith(expect.objectContaining({
      text: '整理客户问题清单',
      summary: '通过微信助手创建',
      followupType: 'other',
    }));
    expect(json.reply).toContain('已新增跟进任务「整理客户问题清单」');
    expect(json.actions).toContainEqual({ type: 'open_followups', label: '去跟进页', followupId: 'todo-1' });
  });

  it('lists active followup tasks from the assistant conversation', async () => {
    mockTodos.push(
      todoItem('todo-1', '整理客户问题清单'),
      todoItem('todo-2', '确认合同回款', { status: 'in_progress' }),
    );

    const res = await POST(makeReq('查看跟进任务列表'));
    const json = await res.json() as { reply: string; actions: Array<{ type: string; label: string }> };

    expect(res.status).toBe(200);
    expect(mockListTodos).toHaveBeenCalledWith({ status: ['open', 'in_progress', 'suggested'] });
    expect(json.reply).toContain('当前有 2 条待处理跟进');
    expect(json.reply).toContain('整理客户问题清单');
    expect(json.reply).toContain('确认合同回款');
    expect(json.actions).toContainEqual({ type: 'open_followups', label: '去跟进页' });
  });

  it('marks a named followup task done without touching automations', async () => {
    mockAutomations.push(automation('daily', '每日微信总结'));
    mockTodos.push(todoItem('todo-1', '整理客户问题清单'));

    const res = await POST(makeReq('完成跟进 整理客户问题清单'));
    const json = await res.json() as {
      reply: string;
      actions: Array<{ type: string; label: string; followupId?: string }>;
    };

    expect(res.status).toBe(200);
    expect(mockSetTodoStatus).toHaveBeenCalledWith('todo-1', 'done');
    expect(mockUpdateWeChatAutomation).not.toHaveBeenCalled();
    expect(json.reply).toContain('已把跟进任务「整理客户问题清单」标记为已完成');
    expect(json.actions).toContainEqual({ type: 'open_followups', label: '去跟进页', followupId: 'todo-1' });
  });
});

function makeReq(message: string): NextRequest {
  return new NextRequest('http://localhost/api/apps/builtin/wechat/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

function automation(id: string, name: string): Automation {
  return {
    id,
    name,
    kind: 'reminder_recurring',
    cron: '0 21 * * *',
    cronLabel: '每天 21:00',
    action: { kind: 'custom', messageTemplate: name },
    enabled: true,
    createdAt: 1,
  };
}

function todoItem(id: string, text: string, overrides: Partial<WeChatTodo> = {}): WeChatTodo {
  return {
    id,
    runId: null,
    text,
    source: 'manual',
    sourceMsgId: null,
    sourceText: null,
    sourceDisplay: null,
    sourceSenderDisplay: null,
    sourceWxid: null,
    involvedWxids: [],
    byWhenText: null,
    summary: null,
    nextStep: null,
    followupType: 'other',
    dueAt: null,
    remindAt: null,
    confidence: null,
    status: 'open',
    createdAt: 1,
    confirmedAt: 1,
    doneAt: null,
    ...overrides,
  };
}
