import { NextRequest } from 'next/server';

import { POST } from '../route';
import { PATCH } from '../[id]/route';

const mockAddManualTodo = jest.fn();
const mockSetTodoStatus = jest.fn();
const mockListTodos = jest.fn();

jest.mock('@/lib/wechat-assistant/db', () => ({
  addManualTodo: (...args: unknown[]) => mockAddManualTodo(...args),
  deleteTodo: jest.fn(),
  listTodos: (...args: unknown[]) => mockListTodos(...args),
  setTodoStatus: (...args: unknown[]) => mockSetTodoStatus(...args),
  updateTodoFollowup: jest.fn(),
}));

describe('wechat assistant todos route', () => {
  beforeEach(() => {
    mockAddManualTodo.mockReset();
    mockSetTodoStatus.mockReset();
    mockListTodos.mockReset();
    mockListTodos.mockReturnValue([]);
    mockAddManualTodo.mockImplementation((input) => ({
      id: 'todo-1',
      runId: null,
      text: input.text,
      source: 'manual',
      sourceMsgId: null,
      sourceText: null,
      sourceDisplay: input.sourceDisplay ?? null,
      sourceWxid: input.sourceWxid ?? null,
      involvedWxids: input.involvedWxids ?? [],
      byWhenText: input.byWhenText ?? null,
      summary: input.summary ?? null,
      nextStep: input.nextStep ?? null,
      followupType: input.followupType ?? 'other',
      dueAt: input.dueAt ?? null,
      remindAt: input.remindAt ?? null,
      confidence: null,
      status: 'open',
      createdAt: 1,
      confirmedAt: 1,
      doneAt: null,
    }));
  });

  it('persists all involved contacts when manually creating a followup', async () => {
    const res = await POST(makeReq({
      kind: 'manual',
      text: '推进合同回款',
      sourceWxid: 'wxid_alice',
      sourceDisplay: 'Alice',
      involvedWxids: ['wxid_alice', 'wxid_bob'],
      summary: '同步跟进 Alice 和 Bob',
      nextStep: '今天下班前确认',
    }));
    const json = await res.json() as { todo: { involvedWxids: string[]; sourceWxid: string | null } };

    expect(res.status).toBe(200);
    expect(mockAddManualTodo).toHaveBeenCalledWith(expect.objectContaining({
      text: '推进合同回款',
      sourceWxid: 'wxid_alice',
      sourceDisplay: 'Alice',
      involvedWxids: ['wxid_alice', 'wxid_bob'],
      summary: '同步跟进 Alice 和 Bob',
      nextStep: '今天下班前确认',
    }));
    expect(json.todo).toEqual(expect.objectContaining({
      sourceWxid: 'wxid_alice',
      involvedWxids: ['wxid_alice', 'wxid_bob'],
    }));
  });

  it('accepts involved contacts in todo patch requests', async () => {
    const mockUpdateTodoFollowup = jest.requireMock('@/lib/wechat-assistant/db').updateTodoFollowup as jest.Mock;
    mockUpdateTodoFollowup.mockReturnValue({
      id: 'todo-1',
      runId: null,
      text: '推进合同回款',
      source: 'manual',
      sourceMsgId: null,
      sourceText: null,
      sourceDisplay: 'Alice',
      sourceWxid: 'wxid_alice',
      involvedWxids: ['wxid_alice', 'wxid_bob'],
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
    });

    const res = await PATCH(makePatchReq('todo-1', {
      involvedWxids: ['wxid_alice', 'wxid_bob'],
    }), { params: Promise.resolve({ id: 'todo-1' }) });
    const json = await res.json() as { todo: { involvedWxids: string[] } };

    expect(res.status).toBe(200);
    expect(mockUpdateTodoFollowup).toHaveBeenCalledWith('todo-1', {
      involvedWxids: ['wxid_alice', 'wxid_bob'],
    });
    expect(json.todo.involvedWxids).toEqual(['wxid_alice', 'wxid_bob']);
  });
});

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/apps/builtin/wechat/todos', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function makePatchReq(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/apps/builtin/wechat/todos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
