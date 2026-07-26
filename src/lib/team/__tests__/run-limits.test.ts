// 团队任务的两道天花板回归:超时 + 轮次。
//
// 病史:超时硬编码 30min(节点上配 100 分钟毫无效果,用户反复看到「超时」却查不出原因),
// 轮次硬编码 40(超时放开后它先撞墙,SDK 停在半路,而这里用已有文本兜底返回 ——
// 步骤显示成功、产出不全,用户同样无从判断)。

const queryCalls: Array<{ options: Record<string, unknown> }> = [];
let streamMessages: unknown[] = [];

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { options: Record<string, unknown> }) => {
    queryCalls.push(args);
    return (async function* () { for (const m of streamMessages) yield m; })();
  },
}));

jest.mock('@/lib/claude/sdk-runtime', () => ({
  buildClaudeSdkInvocationContext: () => ({ env: {}, settingSources: [], activeProvider: null }),
}));
jest.mock('@/lib/claude/provider-env', () => ({ isClaudeLocalAuthProvider: () => false }));
jest.mock('@/lib/claude/local-auth', () => ({ ensureClaudeLocalAuthReady: jest.fn() }));
jest.mock('@/lib/db/providers', () => ({ getProvider: () => undefined }));
jest.mock('@/lib/tools/lumos-mcp-server', () => ({ LUMOS_MCP_SERVER_NAME: 'lumos' }));
jest.mock('../image-server-config', () => ({ buildTeamImageServerConfig: () => ({ type: 'stdio' }) }));
jest.mock('../image-guard', () => ({ createTeamImageGuard: () => 'tok', releaseTeamImageGuard: jest.fn() }));
jest.mock('../store', () => ({
  getTeam: () => ({
    id: 't-1', name: '内容小组', description: '', sop: '',
    memberRefs: [{ presetId: 'p-1', enabled: true }],
    providerId: '', model: '', isDefault: false, createdAt: '', updatedAt: '',
  }),
  resolveTeamMembers: () => [{
    ref: { presetId: 'p-1', enabled: true },
    preset: {
      id: 'p-1', name: '写手', systemPrompt: '写', responsibility: '写稿',
      toolPermissions: { read: true, write: true, exec: true },
    },
  }],
}));

import { runTeamTask } from '../run';

const successResult = { type: 'result', subtype: 'success', result: '交付完成', num_turns: 3 };

beforeEach(() => {
  queryCalls.length = 0;
  streamMessages = [successResult];
});

describe('超时', () => {
  it('调用方传的超时被采用(不再被 30 分钟缺省覆盖)', async () => {
    const r = await runTeamTask({ teamId: 't-1', task: 'x', timeoutMs: 6_000_000 });
    expect(r.timeoutMs).toBe(6_000_000);
    expect(r.timedOut).toBe(false);
  });

  it('没传超时时回落到 30 分钟兜底', async () => {
    const r = await runTeamTask({ teamId: 't-1', task: 'x' });
    expect(r.timeoutMs).toBe(1_800_000);
  });
});

describe('轮次上限随超时缩放', () => {
  it('100 分钟 → 300 轮(每分钟 3 轮)', async () => {
    await runTeamTask({ teamId: 't-1', task: 'x', timeoutMs: 100 * 60_000 });
    expect(queryCalls[0].options.maxTurns).toBe(300);
  });

  it('短超时不低于下限 40 轮', async () => {
    await runTeamTask({ teamId: 't-1', task: 'x', timeoutMs: 5 * 60_000 });
    expect(queryCalls[0].options.maxTurns).toBe(40);
  });

  it('超长超时封顶 400 轮,防失控循环', async () => {
    await runTeamTask({ teamId: 't-1', task: 'x', timeoutMs: 600 * 60_000 });
    expect(queryCalls[0].options.maxTurns).toBe(400);
  });

  it('30 分钟缺省 → 90 轮(比旧的硬编码 40 宽)', async () => {
    await runTeamTask({ teamId: 't-1', task: 'x' });
    expect(queryCalls[0].options.maxTurns).toBe(90);
  });
});

describe('终态如实上报', () => {
  it('轮次耗尽标记 turnsExhausted,不静默兜底', async () => {
    streamMessages = [
      { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: '写了一半' }] } },
      { type: 'result', subtype: 'error_max_turns', num_turns: 40 },
    ];
    const r = await runTeamTask({ teamId: 't-1', task: 'x' });
    expect(r.turnsExhausted).toBe(true);
    expect(r.text).toBe('写了一半');
  });

  it('正常结束时两个标记都为 false', async () => {
    const r = await runTeamTask({ teamId: 't-1', task: 'x' });
    expect(r.turnsExhausted).toBe(false);
    expect(r.timedOut).toBe(false);
  });

  it('无产出时报错自带诊断:超时上限、派单进展、去哪改', async () => {
    streamMessages = [];
    await expect(runTeamTask({ teamId: 't-1', task: 'x', timeoutMs: 60_000 }))
      .rejects.toThrow(/已派单 0 次/);
  });
});
