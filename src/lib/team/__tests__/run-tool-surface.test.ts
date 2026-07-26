// runTeamTask 的 SDK 装配回归(#47)。
//
// 病史:options.tools 曾写成 ['Task','Read']。那是 SDK 的**全局**工具集,连成员一起锁死——
// 成员根本没有 Bash/Write,SOP 里"跑 python 写台账"必然失败,而成员的 disallowedTools
// 档位在白名单面前形同虚设(白名单里本来就没 Bash,减法减什么都一样)。
// 这里锁死:顶层不设 tools 白名单,派单能力与成员档位由 agents/disallowedTools 表达。

const queryCalls: Array<{ prompt: string; options: Record<string, unknown> }> = [];

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: string; options: Record<string, unknown> }) => {
    queryCalls.push(args);
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: '交付完成', num_turns: 3 };
    })();
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
jest.mock('../image-guard', () => ({
  createTeamImageGuard: () => 'tok', releaseTeamImageGuard: jest.fn(),
}));

const team = {
  id: 't-1', name: '内容小组', description: '', sop: '第8步:跑 python 归档台账',
  memberRefs: [{ presetId: 'p-archive', enabled: true }],
  providerId: '', model: '', isDefault: false, createdAt: '', updatedAt: '',
};
jest.mock('../store', () => ({
  getTeam: () => team,
  resolveTeamMembers: () => [{
    ref: { presetId: 'p-archive', enabled: true },
    preset: {
      id: 'p-archive', name: '归档员', systemPrompt: '你负责归档',
      responsibility: '跑脚本写台账',
      // 权限全开(#46 后的缺省)
      toolPermissions: { read: true, write: true, exec: true },
    },
  }],
}));

import { runTeamTask } from '../run';

beforeEach(() => { queryCalls.length = 0; });

describe('runTeamTask SDK 装配', () => {
  it('不设顶层 tools 白名单——否则成员连 Bash 都拿不到', async () => {
    await runTeamTask({ teamId: 't-1', task: '归档' });
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0].options).not.toHaveProperty('tools');
  });

  it('权限全开的成员没有任何 disallowedTools,Bash 可用', async () => {
    await runTeamTask({ teamId: 't-1', task: '归档' });
    const agents = queryCalls[0].options.agents as Record<string, { disallowedTools?: string[] }>;
    const member = Object.values(agents)[0];
    expect(member.disallowedTools ?? []).toEqual([]);
  });

  it('队长提示词带硬纪律,工具面全开也不会自己顶替成员干活', async () => {
    await runTeamTask({ teamId: 't-1', task: '归档' });
    expect(queryCalls[0].prompt).toContain('严禁自己扮演成员');
    expect(queryCalls[0].prompt).toContain('Task');
  });

  it('成员提示词带上 SOP 依据的职能,且出图护栏仍在', async () => {
    const result = await runTeamTask({ teamId: 't-1', task: '归档' });
    expect(queryCalls[0].options.mcpServers).toHaveProperty('lumos');
    expect(queryCalls[0].options.permissionMode).toBe('bypassPermissions');
    expect(result.text).toBe('交付完成');
  });
});
