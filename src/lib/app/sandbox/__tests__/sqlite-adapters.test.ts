import Database from 'better-sqlite3';
import { migrateAppTables } from '@/lib/db/migrations-app';
import { createSqliteDbAdapter } from '../sqlite-adapters';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  migrateAppTables(db);
  return db;
}

describe('createSqliteDbAdapter', () => {
  test('full CRUD cycle', async () => {
    const db = makeDb();
    const adapter = createSqliteDbAdapter({ db, appId: 'a1' });

    expect(await adapter.count('todos')).toBe(0);

    const created = await adapter.create('todos', { title: '写报告', status: 'todo' });
    expect((created as { id: string }).id).toBeTruthy();
    expect((created as { title: string }).title).toBe('写报告');

    const list = await adapter.list('todos');
    expect(list).toHaveLength(1);

    const updated = await adapter.update('todos', (created as { id: string }).id, { status: 'done' });
    expect((updated as { status: string }).status).toBe('done');

    const got = await adapter.get('todos', (created as { id: string }).id);
    expect((got as { title: string }).title).toBe('写报告');

    expect(await adapter.delete('todos', (created as { id: string }).id)).toBe(true);
    expect(await adapter.count('todos')).toBe(0);
  });

  test('rows are scoped per appId', async () => {
    const db = makeDb();
    const a1 = createSqliteDbAdapter({ db, appId: 'a1' });
    const a2 = createSqliteDbAdapter({ db, appId: 'a2' });
    await a1.create('x', { v: 1 });
    await a2.create('x', { v: 2 });
    expect(await a1.count('x')).toBe(1);
    expect(await a2.count('x')).toBe(1);
    const a1List = await a1.list('x');
    const a2List = await a2.list('x');
    expect((a1List[0] as { v: number }).v).toBe(1);
    expect((a2List[0] as { v: number }).v).toBe(2);
  });

  test('list filter eq + sort + limit', async () => {
    const db = makeDb();
    const a = createSqliteDbAdapter({ db, appId: 'a' });
    await a.create('todos', { title: 'a', status: 'todo' });
    await a.create('todos', { title: 'b', status: 'done' });
    await a.create('todos', { title: 'c', status: 'todo' });

    const todos = await a.list('todos', { filter: { status: 'todo' } });
    expect(todos).toHaveLength(2);

    const top1 = await a.list('todos', { limit: 1 });
    expect(top1).toHaveLength(1);

    const byTitle = await a.list('todos', { sort: 'title' });
    expect((byTitle.map((r) => (r as { title: string }).title))).toEqual(['a', 'b', 'c']);

    const byTitleDesc = await a.list('todos', { sort: '-title' });
    expect((byTitleDesc.map((r) => (r as { title: string }).title))).toEqual(['c', 'b', 'a']);
  });

  test('list filter operators (gt / contains / in)', async () => {
    const db = makeDb();
    const a = createSqliteDbAdapter({ db, appId: 'a' });
    await a.create('items', { name: 'apple', price: 5 });
    await a.create('items', { name: 'banana', price: 3 });
    await a.create('items', { name: 'cherry', price: 10 });

    const expensive = await a.list('items', { filter: { price: { gt: 4 } } });
    expect(expensive).toHaveLength(2);

    const ofName = await a.list('items', { filter: { name: { contains: 'an' } } });
    expect((ofName[0] as { name: string }).name).toBe('banana');

    const inSet = await a.list('items', { filter: { name: { in: ['apple', 'cherry'] } } });
    expect(inSet).toHaveLength(2);
  });

  test('update returns null for unknown id', async () => {
    const db = makeDb();
    const a = createSqliteDbAdapter({ db, appId: 'a' });
    expect(await a.update('todos', 'no-such-id', { x: 1 })).toBeNull();
  });

  test('uses caller-supplied id when provided', async () => {
    const db = makeDb();
    const a = createSqliteDbAdapter({ db, appId: 'a' });
    const created = await a.create('todos', { id: 'fixed-1', title: 'x' });
    expect((created as { id: string }).id).toBe('fixed-1');
    expect(await a.get('todos', 'fixed-1')).not.toBeNull();
  });
});
