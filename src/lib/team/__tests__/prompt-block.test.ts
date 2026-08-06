// 团队清单块回归:这是「AI 能不能看到团队」的唯一真源,坏了会让 team 节点在生成侧被整个关掉。
// 用真实 store + in-memory sqlite,只 mock 人设本体——测的是真渲染链路(含就绪成员口径)。

import Database from 'better-sqlite3';

let testDb: InstanceType<typeof Database>;
jest.mock('@/lib/db', () => ({ getDb: () => testDb }));

// tool-grants 只为一个常量字符串 import 了 lumos-mcp-server,会把 SDK 的 ESM 拖进 jest。
jest.mock('@/lib/tools/lumos-mcp-server', () => ({ LUMOS_MCP_SERVER_NAME: 'lumos' }));

const presets = new Map<string, Record<string, unknown>>();
jest.mock('@/lib/db/agent-presets', () => ({
  getAgentPreset: jest.fn((id: string) => presets.get(id) ?? null),
}));

import { createTeam } from '../store';
import { AVAILABLE_TEAMS_HEADING, buildTeamListBlock } from '../prompt-block';

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE lumos_teams (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      sop TEXT NOT NULL DEFAULT '', member_refs TEXT NOT NULL DEFAULT '[]',
      provider_id TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', default_image_provider_id TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  presets.clear();
  presets.set('p-writer', {
    id: 'p-writer', name: '写手', systemPrompt: '你负责写稿', responsibility: '写稿',
  });
  presets.set('p-review', {
    id: 'p-review', name: '审稿', systemPrompt: '你负责审稿', responsibility: '质量把关',
  });
});

describe('buildTeamListBlock', () => {
  it('没有团队时给出空名单占位,与提示词「为空时不要使用 team 节点」的规则对齐', () => {
    const block = buildTeamListBlock();
    expect(block).toContain(AVAILABLE_TEAMS_HEADING);
    expect(block).toContain('do not use team nodes');
  });

  it('列出团队的 id/name/描述/SOP/就绪成员数与花名册', () => {
    const team = createTeam({
      name: '内容小组',
      description: '负责选题到成稿',
      sop: '先选题再写稿最后审核',
      memberRefs: [{ presetId: 'p-writer' }, { presetId: 'p-review' }],
    });
    const block = buildTeamListBlock();
    expect(block).toContain(`- id: "${team.id}"`);
    expect(block).toContain('name: "内容小组"');
    expect(block).toContain('description: "负责选题到成稿"');
    expect(block).toContain('sop: "先选题再写稿最后审核"');
    expect(block).toContain('members: 2');
    expect(block).toContain('写手(写稿)');
    expect(block).toContain('审稿(质量把关)');
  });

  it('就绪口径与运行时一致:停用的成员不计入', () => {
    createTeam({
      name: '半停用组',
      memberRefs: [{ presetId: 'p-writer' }, { presetId: 'p-review', enabled: false }],
    });
    const block = buildTeamListBlock();
    expect(block).toContain('members: 1');
    expect(block).toContain('写手(写稿)');
    expect(block).not.toContain('审稿(质量把关)');
  });

  it('人设已删除的引用不计入(否则谎报人数,队长实际派不出单)', () => {
    createTeam({ name: '残缺组', memberRefs: [{ presetId: 'p-writer' }, { presetId: 'p-gone' }] });
    expect(buildTeamListBlock()).toContain('members: 1');
  });

  it('一个可用成员都没有时明确标记不要选,且不输出花名册', () => {
    createTeam({ name: '空壳组', memberRefs: [{ presetId: 'p-gone' }] });
    const block = buildTeamListBlock();
    expect(block).toContain('members: 0');
    expect(block).toContain('不要选这个团队');
    expect(block).not.toContain('roster:');
  });

  it('描述带换行也不会撑散清单:每个团队恰好一行', () => {
    createTeam({ name: 'A组', description: '第一行\n第二行\n第三行', memberRefs: [{ presetId: 'p-writer' }] });
    createTeam({ name: 'B组', memberRefs: [{ presetId: 'p-review' }] });
    const itemLines = buildTeamListBlock().split('\n').filter((l) => l.startsWith('- id: '));
    expect(itemLines).toHaveLength(2);
    expect(buildTeamListBlock()).toContain('description: "第一行 第二行 第三行"');
  });
});
