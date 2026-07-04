import Database from 'better-sqlite3';
import { backfillSessionKind } from '../migrations';
import { SESSION_MARKERS, SESSION_TITLES, LIBRARY_CHAT_LEGACY_FRAGMENT } from '@/lib/chat/session-kind';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(
    `CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'chat',
      title TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT ''
    )`,
  );
  return db;
}

function insert(db: Database.Database, id: string, title: string, prompt: string): void {
  db.prepare('INSERT INTO chat_sessions (id, title, system_prompt) VALUES (?, ?, ?)').run(
    id,
    title,
    prompt,
  );
}

function read(db: Database.Database, id: string): { kind: string; system_prompt: string } {
  return db.prepare('SELECT kind, system_prompt FROM chat_sessions WHERE id = ?').get(id) as {
    kind: string;
    system_prompt: string;
  };
}

describe('backfillSessionKind — DB 副作用', () => {
  test('marker 会话：回填 kind 且从正文剥掉 marker 行', () => {
    const db = makeDb();
    insert(db, 's1', 'anything', `${SESSION_MARKERS['main-agent']}\nYou are the main agent.`);
    backfillSessionKind(db);
    expect(read(db, 's1')).toEqual({ kind: 'main-agent', system_prompt: 'You are the main agent.' });
  });

  test('标题兜底会话（无 marker）：回填 kind，正文不变', () => {
    const db = makeDb();
    insert(db, 's2', SESSION_TITLES['wechat-assistant'], 'legacy prompt without marker');
    backfillSessionKind(db);
    expect(read(db, 's2')).toEqual({
      kind: 'wechat-assistant',
      system_prompt: 'legacy prompt without marker',
    });
  });

  test('library 标题 + 特征串兜底', () => {
    const db = makeDb();
    insert(db, 's3', SESSION_TITLES.library, `intro ${LIBRARY_CHAT_LEGACY_FRAGMENT} more`);
    backfillSessionKind(db);
    expect(read(db, 's3').kind).toBe('library');
  });

  test('普通会话不动：kind=chat，正文原样', () => {
    const db = makeDb();
    insert(db, 's4', 'New Chat', 'You are a helpful assistant.');
    backfillSessionKind(db);
    expect(read(db, 's4')).toEqual({ kind: 'chat', system_prompt: 'You are a helpful assistant.' });
  });

  test('幂等：二次运行结果不变', () => {
    const db = makeDb();
    insert(db, 's5', 'x', `${SESSION_MARKERS.workflow}\nworkflow assistant`);
    backfillSessionKind(db);
    const after1 = read(db, 's5');
    backfillSessionKind(db);
    const after2 = read(db, 's5');
    expect(after2).toEqual(after1);
    expect(after1).toEqual({ kind: 'workflow', system_prompt: 'workflow assistant' });
  });

  test('多会话混合一次回填', () => {
    const db = makeDb();
    insert(db, 'a', 'x', `${SESSION_MARKERS['ecommerce-assistant']}\nshop`);
    insert(db, 'b', 'x', `${SESSION_MARKERS.creation}\ncreate`);
    insert(db, 'c', 'plain', 'plain');
    backfillSessionKind(db);
    expect(read(db, 'a').kind).toBe('ecommerce-assistant');
    expect(read(db, 'b').kind).toBe('creation');
    expect(read(db, 'c').kind).toBe('chat');
  });
});
