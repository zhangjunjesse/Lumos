// 工作流助手的团队只读工具回归:名单汇总、就绪/不可用计数、空名单引导。
// mock 掉 store 的取数,但让 resolveReadyMembers 真跑——就绪过滤是这个工具的核心口径。

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
}));

interface FakeTeam {
  id: string;
  name: string;
  description: string;
  sop: string;
  memberRefs: Array<{ presetId: string; enabled: boolean }>;
}

const state: { teams: FakeTeam[]; presets: Map<string, Record<string, unknown>> } = {
  teams: [],
  presets: new Map(),
};

jest.mock('@/lib/team/store', () => ({
  listTeams: () => state.teams,
  resolveTeamMembers: (team: FakeTeam) =>
    team.memberRefs.map((ref) => ({ ref, preset: state.presets.get(ref.presetId) ?? null })),
}));

import { createListWorkflowTeamsTool } from '../workflow-teams-tool';

type ToolShape = { name: string; description: string; handler: (args: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> };

async function callTool(): Promise<Record<string, unknown>> {
  const t = createListWorkflowTeamsTool() as unknown as ToolShape;
  const res = await t.handler({});
  return JSON.parse(res.content[0].text) as Record<string, unknown>;
}

beforeEach(() => {
  state.teams = [];
  state.presets = new Map([
    ['p-writer', { id: 'p-writer', name: '写手', systemPrompt: '写稿', responsibility: '写稿' }],
    ['p-review', { id: 'p-review', name: '审稿', systemPrompt: '审稿', responsibility: '质量把关' }],
  ]);
});

describe('list_workflow_teams', () => {
  it('工具名与描述点明「teamId 来自这里」且提醒团队≠部门', () => {
    const t = createListWorkflowTeamsTool() as unknown as ToolShape;
    expect(t.name).toBe('list_workflow_teams');
    expect(t.description).toContain('teamId');
    expect(t.description).toContain('部门');
  });

  it('没有团队时返回 0 并给出去哪创建的引导', async () => {
    const out = await callTool();
    expect(out.total).toBe(0);
    expect(String(out.hint)).toContain('团队');
  });

  it('汇总团队:就绪成员、花名册、可用标记', async () => {
    state.teams = [{
      id: 't-1', name: '内容小组', description: '选题到成稿', sop: '先选题',
      memberRefs: [{ presetId: 'p-writer', enabled: true }, { presetId: 'p-review', enabled: true }],
    }];
    const out = await callTool();
    expect(out.total).toBe(1);
    const team = (out.teams as Array<Record<string, unknown>>)[0];
    expect(team.id).toBe('t-1');
    expect(team.sop).toBe('先选题');
    expect(team.readyMembers).toBe(2);
    expect(team.unavailableMembers).toBe(0);
    expect(team.usable).toBe(true);
    expect(team.roster).toEqual([
      { name: '写手', duty: '写稿' },
      { name: '审稿', duty: '质量把关' },
    ]);
  });

  it('停用/人设缺失的引用算进 unavailableMembers,不进就绪数', async () => {
    state.teams = [{
      id: 't-2', name: '半残组', description: '', sop: '',
      memberRefs: [
        { presetId: 'p-writer', enabled: true },
        { presetId: 'p-review', enabled: false },
        { presetId: 'p-gone', enabled: true },
      ],
    }];
    const team = (await callTool()).teams as Array<Record<string, unknown>>;
    expect(team[0].readyMembers).toBe(1);
    expect(team[0].unavailableMembers).toBe(2);
    expect(team[0].usable).toBe(true);
  });

  it('全员不可用时 usable=false,让助手别选这个团队', async () => {
    state.teams = [{
      id: 't-3', name: '空壳组', description: '', sop: '',
      memberRefs: [{ presetId: 'p-gone', enabled: true }],
    }];
    const team = (await callTool()).teams as Array<Record<string, unknown>>;
    expect(team[0].readyMembers).toBe(0);
    expect(team[0].usable).toBe(false);
  });
});
