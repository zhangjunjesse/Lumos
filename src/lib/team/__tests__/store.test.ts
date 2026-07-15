// 平台团队 store 回归:CRUD、默认唯一、成员引用清洗、missing 人设降级。

import Database from 'better-sqlite3';

let testDb: InstanceType<typeof Database>;
jest.mock('@/lib/db', () => ({ getDb: () => testDb }));
jest.mock('@/lib/db/agent-presets', () => ({
  getAgentPreset: jest.fn((id: string) => (id === 'p1' ? { id: 'p1', name: '调研员' } : null)),
}));

import { createTeam, deleteTeam, getTeam, listTeams, resolveTeamMembers, updateTeam } from '../store';

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE lumos_teams (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      sop TEXT NOT NULL DEFAULT '', member_refs TEXT NOT NULL DEFAULT '[]',
      provider_id TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
});

describe('team store', () => {
  it('创建/读取/更新/删除;空名拒绝', () => {
    expect(() => createTeam({ name: '  ' })).toThrow('团队名不能为空');
    const t = createTeam({ name: '调研组', sop: '先分工再交差', memberRefs: [{ presetId: 'p1' }] });
    expect(getTeam(t.id)?.sop).toBe('先分工再交差');
    expect(getTeam(t.id)?.memberRefs).toEqual([{ presetId: 'p1', enabled: true }]);
    const u = updateTeam(t.id, { sop: '新SOP', model: 'x' });
    expect(u.sop).toBe('新SOP');
    expect(u.model).toBe('x');
    expect(deleteTeam(t.id)).toBe(true);
    expect(getTeam(t.id)).toBeNull();
  });

  it('默认团队唯一:后设默认摘掉前面的', () => {
    const a = createTeam({ name: 'A', isDefault: true });
    const b = createTeam({ name: 'B' });
    updateTeam(b.id, { isDefault: true });
    const teams = listTeams();
    expect(teams.filter((t) => t.isDefault).map((t) => t.name)).toEqual(['B']);
    expect(getTeam(a.id)?.isDefault).toBe(false);
  });

  it('成员引用清洗:无 presetId 的丢弃、enabled 缺省 true、脏 JSON 当空', () => {
    const t = createTeam({ name: 'C', memberRefs: [{ presetId: 'p1', enabled: false }, { bad: 1 }, 'junk'] });
    expect(t.memberRefs).toEqual([{ presetId: 'p1', enabled: false }]);
    testDb.prepare('UPDATE lumos_teams SET member_refs = ? WHERE id = ?').run('not-json', t.id);
    expect(getTeam(t.id)?.memberRefs).toEqual([]);
  });

  it('resolveTeamMembers:在库人设带本体,被删人设 preset=null(降级不丢引用)', () => {
    const t = createTeam({ name: 'D', memberRefs: [{ presetId: 'p1' }, { presetId: 'gone' }] });
    const resolved = resolveTeamMembers(t);
    expect(resolved[0].preset?.name).toBe('调研员');
    expect(resolved[1].preset).toBeNull();
    expect(resolved[1].ref.presetId).toBe('gone');
  });
});
