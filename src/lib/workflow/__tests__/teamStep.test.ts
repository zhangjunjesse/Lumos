// teamStep 落库回归:过去从不写 session 消息,团队节点在详情页因此是黑箱。

const addMessageCalls: Array<{ sessionId: string; role: string; content: string }> = [];
jest.mock('@/lib/db/sessions', () => ({
  addMessage: (sessionId: string, role: string, content: string) => {
    addMessageCalls.push({ sessionId, role, content });
  },
}));

const runTeamTaskMock = jest.fn();
jest.mock('@/lib/team/run', () => ({ runTeamTask: (...a: unknown[]) => runTeamTaskMock(...a) }));
jest.mock('@/lib/team/store', () => ({ getTeam: () => ({ id: 't-1', name: '内容小组' }) }));
jest.mock('@/lib/auth/user-service', () => ({ getActiveUserId: () => 'u-1' }));

import { teamStep } from '../steps/teamStep';

/** 取出落库消息里的 markdown 正文。 */
function persistedMarkdown(): string {
  const blocks = JSON.parse(addMessageCalls[0].content) as Array<{ text: string }>;
  return blocks[0].text;
}

const runtime = { workflowRunId: 'r-1', stepId: 'print-team', stepType: 'team' as const, sessionId: 's-1' };

beforeEach(() => {
  addMessageCalls.length = 0;
  runTeamTaskMock.mockReset();
  runTeamTaskMock.mockResolvedValue({
    text: '台账已归档',
    dispatches: 2,
    dispatchedTo: ['写手', '审稿'],
    subtype: 'success',
    trace: {
      leader: [{ type: 'assistant', raw: { message: { content: [{ type: 'tool_use', name: 'Task', input: { subagent_type: '写手' } }] } } }],
      members: [{ toolUseId: 'tu-1', member: '写手', events: [{ type: 'assistant', raw: { message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'python x.py' } }] } } }] }],
    },
    timedOut: false,
    timeoutMs: 1_800_000,
  });
});

describe('teamStep 超时配置', () => {
  it('把节点上配置的超时传给团队运行时(曾漏传,导致 100 分钟设置被 30 分钟缺省覆盖)', async () => {
    await teamStep({
      teamId: 't-1', task: '归档',
      __runtime: { ...runtime, timeoutMs: 6_000_000 }, // 100 分钟
    });
    expect(runTeamTaskMock).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 6_000_000 }));
  });

  it('节点没配超时时不传,让运行时用自己的缺省', async () => {
    await teamStep({ teamId: 't-1', task: '归档', __runtime: { ...runtime, timeoutMs: undefined } });
    expect(runTeamTaskMock.mock.calls[0][0]).not.toHaveProperty('timeoutMs');
  });

  it('非法超时值(0 / 负数 / NaN)不传下去', async () => {
    for (const bad of [0, -1, Number.NaN]) {
      runTeamTaskMock.mockClear();
      await teamStep({ teamId: 't-1', task: '归档', __runtime: { ...runtime, timeoutMs: bad } });
      expect(runTeamTaskMock.mock.calls[0][0]).not.toHaveProperty('timeoutMs');
    }
  });

  it('超时但有产出时:步骤算成功,执行记录里明确提示产出可能不全', async () => {
    runTeamTaskMock.mockResolvedValue({
      text: '只写了一半', dispatches: 1, dispatchedTo: ['写手'], subtype: 'timeout',
      trace: { leader: [], members: [] }, timedOut: true, timeoutMs: 6_000_000,
    });
    const r = await teamStep({ teamId: 't-1', task: '归档', __runtime: runtime });
    expect(r.success).toBe(true);
    const md = persistedMarkdown();
    expect(md).toContain('达到超时上限');
    expect(md).toContain('100m0s');
    expect(md).toContain('产出可能不完整');
  });
});

describe('teamStep', () => {
  it('成功时写一条含执行过程的 session 消息', async () => {
    const r = await teamStep({ teamId: 't-1', task: '归档', __runtime: runtime });
    expect(r.success).toBe(true);
    expect(addMessageCalls).toHaveLength(1);
    expect(addMessageCalls[0].sessionId).toBe('s-1');
    expect(addMessageCalls[0].role).toBe('assistant');

    const md = persistedMarkdown();
    expect(md).toContain('<!-- step:内容小组:print-team:done -->');
    expect(md).toContain('派单 2 次');
    expect(md).toContain('##### 成员「写手」');
    expect(md).toContain('python x.py');
  });

  it('输出仍带 dispatches / dispatched_to 供下游 DSL 引用', async () => {
    const r = await teamStep({ teamId: 't-1', task: '归档', __runtime: runtime });
    expect(r.output).toEqual({ text: '台账已归档', dispatches: 2, dispatched_to: ['写手', '审稿'] });
  });

  it('失败时也留痕,并写进失败原因', async () => {
    runTeamTaskMock.mockRejectedValue(new Error('团队任务超时且无任何产出'));
    const r = await teamStep({ teamId: 't-1', task: '归档', __runtime: runtime });
    expect(r.success).toBe(false);
    expect(addMessageCalls).toHaveLength(1);
    const md = persistedMarkdown();
    expect(md).toContain(':failed -->');
    expect(md).toContain('团队任务超时且无任何产出');
  });

  it('伪会话 id(workflow: 前缀)不写库,与 agent 步骤同一条守卫', async () => {
    await teamStep({ teamId: 't-1', task: '归档', __runtime: { ...runtime, sessionId: 'workflow:abc' } });
    expect(addMessageCalls).toHaveLength(0);
  });

  it('没有 sessionId 时不写库,也不影响步骤成功', async () => {
    const r = await teamStep({ teamId: 't-1', task: '归档', __runtime: { ...runtime, sessionId: undefined } });
    expect(r.success).toBe(true);
    expect(addMessageCalls).toHaveLength(0);
  });

  it('写库抛异常不能影响步骤成败(记录是副产物)', async () => {
    const sessions = jest.requireMock('@/lib/db/sessions') as { addMessage: unknown };
    const original = sessions.addMessage;
    sessions.addMessage = () => { throw new Error('db locked'); };
    const r = await teamStep({ teamId: 't-1', task: '归档', __runtime: runtime });
    expect(r.success).toBe(true);
    sessions.addMessage = original;
  });

  it('缺 teamId / task 时直接报错,不调用团队运行时', async () => {
    expect((await teamStep({ teamId: '  ', task: 'x' })).success).toBe(false);
    expect((await teamStep({ teamId: 't-1', task: '  ' })).success).toBe(false);
    expect(runTeamTaskMock).not.toHaveBeenCalled();
  });
});
