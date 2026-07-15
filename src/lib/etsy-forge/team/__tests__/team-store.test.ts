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
import { createTeam, deleteTeam, ensureBuiltinTeams, getEffectiveTeam, listTeams, updateTeam } from '../team-store';
import { BUILTIN_TEAMS, DEFAULT_TEAM_NAME } from '../builtin';

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
  it('首次 list 自动 seed 全部内置团队,首个是默认;再次 list 不重复 seed', () => {
    const store = setupStore();
    const first = listTeams(store, USER);
    expect(first).toHaveLength(BUILTIN_TEAMS.length);
    // 默认团队排第一、is_default,SOP 非空,唯一出图位是「出图师」
    expect(first[0].name).toBe(DEFAULT_TEAM_NAME);
    expect(first[0].is_default).toBe(true);
    expect(first[0].sop).toContain('流程');
    expect(first[0].members.filter((m) => m.canGenerateImages).map((m) => m.name)).toEqual(['出图师']);
    // 每个内置团队:名字/SOP/成员齐全,至少一个成员有出图权限,职能描述都不空
    for (const t of first) {
      expect(t.sop.length).toBeGreaterThan(0);
      expect(t.members.length).toBeGreaterThan(0);
      expect(t.members.some((m) => m.canGenerateImages)).toBe(true);
      expect(t.members.every((m) => m.duty.length > 0 && m.prompt.length > 0)).toBe(true);
    }
    // 只有一个默认团队
    expect(first.filter((t) => t.is_default)).toHaveLength(1);

    ensureBuiltinTeams(store, USER);
    expect(listTeams(store, USER)).toHaveLength(BUILTIN_TEAMS.length);
  });

  it('已有同名团队时不重复 seed(用户改过的不覆盖);新增内置团队会补给老用户', () => {
    const store = setupStore();
    listTeams(store, USER); // 先 seed 全部
    // 用户改了默认团队的 SOP
    const def = listTeams(store, USER).find((t) => t.name === DEFAULT_TEAM_NAME)!;
    store.update('etsy_forge_agent_teams', def.id, { sop: '我自己改的 SOP' });
    // 删掉一个非默认内置团队,模拟"老用户没有这个新团队"
    const toDelete = listTeams(store, USER).find((t) => t.name === BUILTIN_TEAMS[1].name)!;
    store.delete('etsy_forge_agent_teams', toDelete.id);

    ensureBuiltinTeams(store, USER);
    const after = listTeams(store, USER);
    // 被删的补回来了
    expect(after.some((t) => t.name === BUILTIN_TEAMS[1].name)).toBe(true);
    // 用户改过的默认团队 SOP 没被覆盖
    expect(after.find((t) => t.name === DEFAULT_TEAM_NAME)?.sop).toBe('我自己改的 SOP');
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

  it('pristine 刷新:没被用户改过的内置团队行,内置定义升级时自动刷新到新版', () => {
    const store = setupStore();
    listTeams(store, USER); // seed
    const seeded = listTeams(store, USER)[0];
    // 模拟"内置定义已升级、行还是老版"的 legacy 行:内容是旧的、没有指纹、从没被用户动过
    store.update('etsy_forge_agent_teams', seeded.id, { sop: '旧版 SOP', builtin_hash: '' });
    const refreshed = listTeams(store, USER)[0];
    expect(refreshed.sop).toContain('流程'); // 刷成当前内置定义
    expect(refreshed.builtin_hash).toBeTruthy(); // 补上指纹,以后升级判断走哈希

    // 用户改过内容的(有指纹但内容对不上)绝不刷新
    store.update('etsy_forge_agent_teams', seeded.id, { sop: '我精心调过的 SOP' });
    expect(listTeams(store, USER)[0].sop).toBe('我精心调过的 SOP');

    // 改过名的团队不回填;同名内置团队会重新补建(用户资产和内置款并存)
    store.update('etsy_forge_agent_teams', seeded.id, { name: '我的团队' });
    const after = listTeams(store, USER);
    expect(after.find((t) => t.name === '我的团队')?.sop).toBe('我精心调过的 SOP');
    expect(after.some((t) => t.name === DEFAULT_TEAM_NAME)).toBe(true);
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
