// 团队管家工具层回归:权限默认只读、成员引用校验、加减成员、部门归属(#56)。store 全 mock,只测工具逻辑。

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _desc: string, _schema: unknown, handler: unknown) => ({ name, handler }),
  createSdkMcpServer: (cfg: { name: string; tools: unknown[] }) => ({ name: cfg.name, tools: cfg.tools }),
}));

interface MemberRow {
  id: string;
  name: string;
  departmentId?: string | null;
  toolPermissions?: { read: boolean; write: boolean; exec: boolean };
}
const store = {
  members: new Map<string, MemberRow>(),
  departments: new Map<string, { id: string; name: string; description: string }>(),
};
jest.mock('@/lib/db/agent-presets', () => ({
  createAgentPreset: jest.fn((input: { name: string; toolPermissions: unknown; departmentId?: string }) => {
    const id = `m-${store.members.size + 1}`;
    store.members.set(id, { id, name: input.name, departmentId: input.departmentId ?? null });
    (store as { lastCreate?: unknown }).lastCreate = input;
    return { id, name: input.name };
  }),
  getAgentPreset: jest.fn((id: string) => store.members.get(id) ?? null),
  listAgentPresets: jest.fn(() => [...store.members.values()]),
  updateAgentPreset: jest.fn((id: string, patch: Partial<MemberRow> & { departmentId?: string | null }) => {
    const existing = store.members.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    store.members.set(id, merged);
    return merged;
  }),
}));
jest.mock('@/lib/db/team-departments', () => ({
  listDepartments: jest.fn(() => [...store.departments.values()]),
  getDepartment: jest.fn((id: string) => store.departments.get(id) ?? null),
  createDepartment: jest.fn((input: { name: string; description?: string }) => {
    const id = `d-${store.departments.size + 1}`;
    const dept = { id, name: input.name, description: input.description ?? '' };
    store.departments.set(id, dept);
    return dept;
  }),
}));
jest.mock('@/lib/team/store', () => ({
  createTeam: jest.fn((input: { name: string; memberRefs: unknown[] }) => ({ id: 't-1', name: input.name, memberRefs: input.memberRefs })),
  getTeam: jest.fn(() => ({ id: 't-1', name: '队', memberRefs: [{ presetId: 'm-1', enabled: true }] })),
  updateTeam: jest.fn((_id: string, patch: { memberRefs?: unknown[] }) => ({ id: 't-1', name: '队', memberRefs: patch.memberRefs ?? [{ presetId: 'm-1', enabled: true }] })),
  listTeams: jest.fn(() => []),
}));

import { createLumosTeamMcpServer } from '../lumos-team-mcp-server';
import { createAgentPreset, getAgentPreset, updateAgentPreset } from '@/lib/db/agent-presets';
import { createDepartment } from '@/lib/db/team-departments';
import { updateTeam } from '@/lib/team/store';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
function toolMap() {
  const server = createLumosTeamMcpServer() as unknown as { tools: Array<{ name: string; handler: Handler }> };
  return new Map(server.tools.map((t) => [t.name, t.handler]));
}
const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

beforeEach(() => {
  store.members.clear();
  store.departments.clear();
  jest.clearAllMocks();
  // clearAllMocks 只清调用记录、不还原实现:上面 create_team 用例里的 mockReturnValue
  // 会一直生效到后续用例,让 getAgentPreset 返回没有权限字段的假成员。这里显式还原。
  (getAgentPreset as jest.Mock).mockImplementation((id: string) => store.members.get(id) ?? null);
});

describe('lumos-team tools', () => {
  it('工具清单:成员/团队/部门三类齐全', () => {
    expect([...toolMap().keys()].sort()).toEqual(
      [
        'create_department', 'create_member', 'create_team',
        'list_departments', 'list_members', 'list_teams',
        'update_member', 'update_team',
      ].sort(),
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

  /* ── 部门归属(#56) ───────────────────────────────────── */

  it('create_department:同名不重复建,直接复用', async () => {
    const first = await toolMap().get('create_department')!({ name: '内容部' });
    expect(parse(first).success).toBe(true);
    const again = await toolMap().get('create_department')!({ name: '内容部' });
    expect(parse(again).department.id).toBe(parse(first).department.id);
    expect(parse(again).note).toContain('已直接复用');
    expect((createDepartment as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('create_member:部门不存在要拒,不能静默建成无部门成员', async () => {
    const r = await toolMap().get('create_member')!({ name: 'a', responsibility: 'b', system_prompt: 'c', department_id: 'ghost' });
    expect(r.isError).toBe(true);
    expect(parse(r).error).toContain('部门不存在');
    expect(createAgentPreset).not.toHaveBeenCalled();
  });

  it('update_member:把已有成员移进部门——不需要新建重复成员', async () => {
    await toolMap().get('create_department')!({ name: '内容部' });
    await toolMap().get('create_member')!({ name: '调研员', responsibility: 'r', system_prompt: 's' });

    const r = await toolMap().get('update_member')!({ member_id: 'm-1', department_id: 'd-1' });
    expect(parse(r).success).toBe(true);
    expect(parse(r).member.department_id).toBe('d-1');
    expect((updateAgentPreset as jest.Mock).mock.calls[0][1].departmentId).toBe('d-1');
    // 全程只建过一名成员,没有为了换部门而复制
    expect((createAgentPreset as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('update_member:department_id 传 null 表示移出部门', async () => {
    store.members.set('m-1', { id: 'm-1', name: 'a', departmentId: 'd-1' });
    const r = await toolMap().get('update_member')!({ member_id: 'm-1', department_id: null });
    expect(parse(r).success).toBe(true);
    expect((updateAgentPreset as jest.Mock).mock.calls[0][1].departmentId).toBeNull();
  });

  it('update_member:不传 department_id 就不动部门', async () => {
    store.members.set('m-1', { id: 'm-1', name: 'a', departmentId: 'd-1' });
    await toolMap().get('update_member')!({ member_id: 'm-1', name: '新名' });
    expect((updateAgentPreset as jest.Mock).mock.calls[0][1]).not.toHaveProperty('departmentId');
  });

  it('update_member:部门不存在要拒', async () => {
    store.members.set('m-1', { id: 'm-1', name: 'a' });
    const r = await toolMap().get('update_member')!({ member_id: 'm-1', department_id: 'ghost' });
    expect(r.isError).toBe(true);
    expect(parse(r).error).toContain('部门不存在');
    expect(updateAgentPreset).not.toHaveBeenCalled();
  });

  it('update_member:成员不存在要拒', async () => {
    const r = await toolMap().get('update_member')!({ member_id: 'ghost' });
    expect(r.isError).toBe(true);
    expect(parse(r).error).toContain('成员不存在');
  });

  it('update_member:权限按项合并——只传 write 不该把原有的 exec 关掉', async () => {
    store.members.set('m-1', { id: 'm-1', name: 'a', toolPermissions: { read: true, write: false, exec: true } });
    await toolMap().get('update_member')!({ member_id: 'm-1', permissions: { write: true } });
    expect((updateAgentPreset as jest.Mock).mock.calls[0][1].toolPermissions).toEqual({ read: true, write: true, exec: true });
  });

  it('update_member:不传 permissions 就完全不动权限', async () => {
    store.members.set('m-1', { id: 'm-1', name: 'a', toolPermissions: { read: true, write: true, exec: false } });
    await toolMap().get('update_member')!({ member_id: 'm-1', name: '新名' });
    expect((updateAgentPreset as jest.Mock).mock.calls[0][1]).not.toHaveProperty('toolPermissions');
  });

  it('list_members:带出部门名,部门被删时不崩', async () => {
    store.departments.set('d-1', { id: 'd-1', name: '内容部', description: '' });
    store.members.set('m-1', { id: 'm-1', name: 'a', departmentId: 'd-1' });
    store.members.set('m-2', { id: 'm-2', name: 'b', departmentId: 'gone' });
    store.members.set('m-3', { id: 'm-3', name: 'c' });

    const members = parse(await toolMap().get('list_members')!({})).members;
    expect(members[0].department).toEqual({ id: 'd-1', name: '内容部' });
    expect(members[1].department.name).toBe('(部门已删除)');
    expect(members[2].department).toBeNull();
  });
});
