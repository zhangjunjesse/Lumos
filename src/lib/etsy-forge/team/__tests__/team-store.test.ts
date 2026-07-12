// 出图团队 CRUD 单测:隔离内存 DB(模式同 sop/engine.test),验证 seed 幂等、
// 默认团队唯一性、成员清洗、删除边界。

import Database from 'better-sqlite3';

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
  tool: jest.fn(() => ({})),
  createSdkMcpServer: jest.fn(() => ({})),
}));

import { migrateAppTables } from '../../../db/migrations-app';
import { createAppDataStore, type AppDataStore } from '../../../app/runtime/data-store';
import { createTeam, deleteTeam, ensureDefaultTeam, getEffectiveTeam, listTeams, updateTeam } from '../team-store';
import { DEFAULT_TEAM_NAME } from '../default-team';

function setupStore(): AppDataStore {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('etsy-forge', 'etsy-forge', '1.0.0', '{}', 'builtin', '/tmp/etsy-forge', Date.now());
  return createAppDataStore(db, 'etsy-forge');
}

const USER = 'u1';

describe('team-store', () => {
  it('首次 list 自动 seed 默认团队(SOP 非空,仅设计师有出图权限),再次 list 不重复 seed', () => {
    const store = setupStore();
    const first = listTeams(store, USER);
    expect(first).toHaveLength(1);
    expect(first[0].name).toBe(DEFAULT_TEAM_NAME);
    expect(first[0].is_default).toBe(true);
    expect(first[0].sop).toContain('流程'); // 队长工作手册随 seed 落库
    expect(first[0].members).toHaveLength(3);
    expect(first[0].members.filter((m) => m.canGenerateImages).map((m) => m.name)).toEqual(['设计师']);
    expect(first[0].members.every((m) => m.duty.length > 0)).toBe(true);

    ensureDefaultTeam(store, USER);
    expect(listTeams(store, USER)).toHaveLength(1);
  });

  it('getEffectiveTeam:指定 id 用指定团队,不指定用默认团队,别人的团队拿不到', () => {
    const store = setupStore();
    listTeams(store, USER); // 先触发默认团队 seed(seed 只在用户零团队时发生)
    const mine = createTeam(store, USER, { name: '我的团队', members: [{ name: 'A', duty: '出图', prompt: 'p', canGenerateImages: true, enabled: true }] });
    expect(getEffectiveTeam(store, USER, mine.id)?.name).toBe('我的团队');
    expect(getEffectiveTeam(store, USER)?.name).toBe(DEFAULT_TEAM_NAME);
    expect(getEffectiveTeam(store, 'other-user', mine.id)).toBeUndefined();
  });

  it('设默认唯一:新团队设默认后,原默认团队摘标', () => {
    const store = setupStore();
    const t = createTeam(store, USER, { name: '二队' });
    updateTeam(store, USER, t.id, { is_default: true });
    const teams = listTeams(store, USER);
    expect(teams.filter((x) => x.is_default)).toHaveLength(1);
    expect(teams.find((x) => x.is_default)?.id).toBe(t.id);
  });

  it('成员清洗:空名补位、enabled 缺省 true、出图权限缺省 false;images_per_run 夹在 1-12', () => {
    const store = setupStore();
    const t = createTeam(store, USER, {
      name: '清洗',
      members: [{ prompt: 'x' }, { name: ' 设计B ', duty: '出图', prompt: 'y', canGenerateImages: true, enabled: false }],
      images_per_run: 99,
    });
    expect(t.members[0].name).toBe('成员1');
    expect(t.members[0].enabled).toBe(true);
    expect(t.members[0].canGenerateImages).toBe(false); // 花钱权限缺省关
    expect(t.members[1].name).toBe('设计B');
    expect(t.members[1].canGenerateImages).toBe(true);
    expect(t.images_per_run).toBe(12);
  });

  it('旧数据兼容:固定 role 时代的成员读出来自动转新形态(designer→可出图,role 映射职能描述)', () => {
    const store = setupStore();
    const t = createTeam(store, USER, {
      name: '老团队',
      members: [
        { name: '老策划', role: 'strategist', prompt: 'a', enabled: true },
        { name: '老设计', role: 'designer', prompt: 'b', enabled: true },
      ],
    });
    expect(t.members[0].canGenerateImages).toBe(false);
    expect(t.members[0].duty).toContain('策划');
    expect(t.members[1].canGenerateImages).toBe(true);
    expect(t.members[1].duty).toContain('出图');
  });

  it('老默认团队 SOP 为空时自动回填(改过名或写过 SOP 的不碰)', () => {
    const store = setupStore();
    listTeams(store, USER); // seed
    const seeded = listTeams(store, USER)[0];
    // 模拟 SOP 字段上线前的老行:清空 sop
    store.update('etsy_forge_agent_teams', seeded.id, { sop: '' });
    const refilled = listTeams(store, USER)[0]; // ensureDefaultTeam 兜底回填
    expect(refilled.sop).toContain('流程');

    // 改过名的团队即使 SOP 为空也不回填(用户资产)
    store.update('etsy_forge_agent_teams', seeded.id, { name: '我的团队', sop: '' });
    expect(listTeams(store, USER)[0].sop).toBe('');
  });

  it('SOP 随建随改,读路径永远有 sop 字段(老行缺失时归空串)', () => {
    const store = setupStore();
    const t = createTeam(store, USER, { name: '带SOP', sop: '  先讨论再出图 {N} 张  ' });
    expect(t.sop).toBe('先讨论再出图 {N} 张');
    const updated = updateTeam(store, USER, t.id, { sop: '新流程' });
    expect(updated.sop).toBe('新流程');
  });

  it('空团队名创建/改名都拒绝;删除只删自己的', () => {
    const store = setupStore();
    expect(() => createTeam(store, USER, { name: '  ' })).toThrow('团队名不能为空');
    const t = createTeam(store, USER, { name: '要删的' });
    expect(() => updateTeam(store, USER, t.id, { name: '' })).toThrow('团队名不能为空');
    deleteTeam(store, 'other-user', t.id); // 别人删不掉
    expect(getEffectiveTeam(store, USER, t.id)).toBeDefined();
    deleteTeam(store, USER, t.id);
    expect(getEffectiveTeam(store, USER, t.id)).toBeUndefined();
  });
});
