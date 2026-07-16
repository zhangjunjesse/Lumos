// 团队管家工具层回归:权限默认只读、成员引用校验、加减成员。store 全 mock,只测工具逻辑。

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _desc: string, _schema: unknown, handler: unknown) => ({ name, handler }),
  createSdkMcpServer: (cfg: { name: string; tools: unknown[] }) => ({ name: cfg.name, tools: cfg.tools }),
}));

const store = {
  members: new Map<string, { id: string; name: string }>(),
};
jest.mock('@/lib/db/agent-presets', () => ({
  createAgentPreset: jest.fn((input: { name: string; toolPermissions: unknown }) => {
    const id = `m-${store.members.size + 1}`;
    store.members.set(id, { id, name: input.name });
    (store as { lastCreate?: unknown }).lastCreate = input;
    return { id, name: input.name };
  }),
  getAgentPreset: jest.fn((id: string) => store.members.get(id) ?? null),
  listAgentPresets: jest.fn(() => [...store.members.values()]),
}));
jest.mock('@/lib/team/store', () => ({
  createTeam: jest.fn((input: { name: string; memberRefs: unknown[] }) => ({ id: 't-1', name: input.name, memberRefs: input.memberRefs })),
  getTeam: jest.fn(() => ({ id: 't-1', name: '队', memberRefs: [{ presetId: 'm-1', enabled: true }] })),
  updateTeam: jest.fn((_id: string, patch: { memberRefs?: unknown[] }) => ({ id: 't-1', name: '队', memberRefs: patch.memberRefs ?? [{ presetId: 'm-1', enabled: true }] })),
  listTeams: jest.fn(() => []),
}));

import { createLumosTeamMcpServer } from '../lumos-team-mcp-server';
import { createAgentPreset, getAgentPreset } from '@/lib/db/agent-presets';
import { updateTeam } from '@/lib/team/store';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
function toolMap() {
  const server = createLumosTeamMcpServer() as unknown as { tools: Array<{ name: string; handler: Handler }> };
  return new Map(server.tools.map((t) => [t.name, t.handler]));
}
const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

beforeEach(() => { store.members.clear(); jest.clearAllMocks(); });

describe('lumos-team tools', () => {
  it('五个工具都在', () => {
    expect([...toolMap().keys()].sort()).toEqual(
      ['create_member', 'create_team', 'list_members', 'list_teams', 'update_team'].sort(),
    );
  });

  it('create_member:权限缺省只读(read=true,write/exec=false)', async () => {
    const r = await toolMap().get('create_member')!({ name: '调研员', responsibility: '调研', system_prompt: '你是调研员' });
    expect(parse(r).success).toBe(true);
    expect((createAgentPreset as jest.Mock).mock.calls[0][0].toolPermissions).toEqual({ read: true, write: false, exec: false });
  });

  it('create_member:显式给 exec 才开', async () => {
    await toolMap().get('create_member')!({ name: 'x', responsibility: 'y', system_prompt: 'z', permissions: { exec: true } });
    expect((createAgentPreset as jest.Mock).mock.calls[0][0].toolPermissions).toEqual({ read: true, write: false, exec: true });
  });

  it('create_team:引用不存在的成员被拒', async () => {
    const r = await toolMap().get('create_team')!({ name: '队', sop: '流程', member_ids: ['nope'] });
    expect(r.isError).toBe(true);
    expect(parse(r).error).toContain('成员不存在');
  });

  it('create_team:成员存在则建队并转成 memberRefs', async () => {
    (getAgentPreset as jest.Mock).mockReturnValue({ id: 'm-1', name: 'a' });
    const r = await toolMap().get('create_team')!({ name: '内容组', sop: '先调研再写', member_ids: ['m-1', 'm-2'] });
    expect(parse(r).success).toBe(true);
    expect(parse(r).team.member_count).toBe(2);
  });

  it('update_team:加减成员——移除现有、加入新成员', async () => {
    (getAgentPreset as jest.Mock).mockImplementation((id: string) => (id === 'm-2' ? { id, name: 'b' } : id === 'm-1' ? { id, name: 'a' } : null));
    const r = await toolMap().get('update_team')!({ team_id: 't-1', add_member_ids: ['m-2'], remove_member_ids: ['m-1'] });
    expect(parse(r).success).toBe(true);
    const refs = (updateTeam as jest.Mock).mock.calls[0][1].memberRefs as Array<{ presetId: string }>;
    expect(refs.map((x) => x.presetId)).toEqual(['m-2']);
  });
});
