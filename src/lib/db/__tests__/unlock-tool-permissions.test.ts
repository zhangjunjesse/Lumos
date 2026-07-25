// #46 存量成员权限解锁迁移回归。
// 这个迁移会改用户数据,两条铁律必须锁死:
//   1. 显式存的 write/exec=false 要被刷开(缺省改全开救不了存量)
//   2. 只跑一次 —— 用户之后手动收紧的档位,下次启动不能被重新打开
//
// 迁移函数是 module-private,这里用同一段 SQL 建同构库验证行为契约。

import Database from 'better-sqlite3';

let db: InstanceType<typeof Database>;

const FLAG_KEY = 'team_tool_permissions_unlocked_v1';

/** 与 migrations-lumos.ts 的 unlockTeamMemberToolPermissions 同一段 SQL。 */
function runUnlock(): number {
  const done = db.prepare('SELECT value FROM settings WHERE key = ?').get(FLAG_KEY);
  if (done) return 0;
  const result = db.prepare(`
    UPDATE templates
    SET content_skeleton = json_set(
          json_set(content_skeleton, '$.toolPermissions.write', json('true')),
          '$.toolPermissions.exec', json('true'))
    WHERE type = 'conversation'
      AND json_valid(content_skeleton)
      AND json_extract(content_skeleton, '$.toolPermissions') IS NOT NULL
      AND (json_extract(content_skeleton, '$.toolPermissions.write') = 0
        OR json_extract(content_skeleton, '$.toolPermissions.exec') = 0)
  `).run();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(FLAG_KEY, '2026-07-25T00:00:00.000Z');
  return result.changes;
}

function addPreset(id: string, name: string, skeleton: unknown, type = 'conversation'): void {
  db.prepare('INSERT INTO templates (id, name, type, content_skeleton) VALUES (?, ?, ?, ?)')
    .run(id, name, type, typeof skeleton === 'string' ? skeleton : JSON.stringify(skeleton));
}

function permsOf(id: string): { read?: boolean; write?: boolean; exec?: boolean } | null {
  const row = db.prepare("SELECT json_extract(content_skeleton, '$.toolPermissions') AS p FROM templates WHERE id = ?")
    .get(id) as { p: string | null };
  return row.p ? JSON.parse(row.p) : null;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, content_skeleton TEXT NOT NULL
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
});

describe('unlockTeamMemberToolPermissions', () => {
  it('把显式关闭的 write/exec 刷成 true,保留其他字段', () => {
    addPreset('p1', '台账归档员', {
      name: '台账归档员',
      systemPrompt: '你负责归档',
      toolPermissions: { read: true, write: false, exec: false },
    });
    expect(runUnlock()).toBe(1);
    expect(permsOf('p1')).toEqual({ read: true, write: true, exec: true });
    const row = db.prepare('SELECT content_skeleton AS c FROM templates WHERE id = ?').get('p1') as { c: string };
    expect(JSON.parse(row.c).systemPrompt).toBe('你负责归档');
  });

  it('存成 JSON true/false 而不是 1/0(否则 TS 侧布尔判断会错)', () => {
    addPreset('p1', 'A', { toolPermissions: { read: true, write: false, exec: false } });
    runUnlock();
    const row = db.prepare('SELECT content_skeleton AS c FROM templates WHERE id = ?').get('p1') as { c: string };
    expect(row.c).toContain('"write":true');
    expect(row.c).not.toContain('"write":1');
  });

  it('已经全开的不动', () => {
    addPreset('p1', 'A', { toolPermissions: { read: true, write: true, exec: true } });
    expect(runUnlock()).toBe(0);
    expect(permsOf('p1')).toEqual({ read: true, write: true, exec: true });
  });

  it('没有 toolPermissions 字段的不动(它们走代码里的全开缺省)', () => {
    addPreset('p1', 'A', { name: 'A', systemPrompt: 'x' });
    expect(runUnlock()).toBe(0);
    expect(permsOf('p1')).toBeNull();
  });

  it('只处理对话人设,不碰其他类型的模板', () => {
    addPreset('p1', 'A', { toolPermissions: { read: true, write: false, exec: false } }, 'workflow');
    expect(runUnlock()).toBe(0);
    expect(permsOf('p1')).toEqual({ read: true, write: false, exec: false });
  });

  it('只跑一次:标记写下后,用户手动收紧的档位不会被再次打开', () => {
    addPreset('p1', 'A', { toolPermissions: { read: true, write: false, exec: false } });
    expect(runUnlock()).toBe(1);
    // 用户事后手动关掉 exec
    db.prepare(`UPDATE templates SET content_skeleton = json_set(content_skeleton, '$.toolPermissions.exec', json('false')) WHERE id = 'p1'`).run();
    expect(runUnlock()).toBe(0);
    expect(permsOf('p1')).toEqual({ read: true, write: true, exec: false });
  });

  it('content_skeleton 不是合法 JSON 时跳过,不炸掉整个迁移', () => {
    addPreset('bad', 'B', 'not-json-at-all');
    addPreset('good', 'G', { toolPermissions: { read: true, write: false, exec: false } });
    expect(runUnlock()).toBe(1);
    expect(permsOf('good')).toEqual({ read: true, write: true, exec: true });
  });
});
