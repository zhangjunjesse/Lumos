import Database from 'better-sqlite3';

import { migrateAppTables } from '../../../db/migrations-app';
import { createSessionStore } from '../session';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  return { db, store: createSessionStore(db) };
}

describe('SessionStore — sessions', () => {
  it('createSession produces a unique id and gathering status by default', () => {
    const { store } = setup();
    const a = store.createSession();
    const b = store.createSession();
    expect(a.id).not.toBe(b.id);
    expect(a.status).toBe('gathering');
  });

  it('initialStatus override works', () => {
    const { store } = setup();
    const s = store.createSession({ initialStatus: 'iterating' });
    expect(s.status).toBe('iterating');
  });

  it('getSession returns null when missing', () => {
    const { store } = setup();
    expect(store.getSession('bs_nope')).toBeNull();
  });

  it('listSessions sorts by updated_at desc', async () => {
    const { store } = setup();
    const a = store.createSession();
    await new Promise((r) => setTimeout(r, 5));
    const b = store.createSession();
    const list = store.listSessions();
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it('updateStatus + filter by status', () => {
    const { store } = setup();
    const a = store.createSession();
    const b = store.createSession();
    store.updateStatus(b.id, 'failed');
    const failed = store.listSessions({ status: 'failed' });
    expect(failed.map((s) => s.id)).toEqual([b.id]);
    expect(store.listSessions({ status: 'gathering' }).map((s) => s.id)).toEqual([a.id]);
  });

  it('setNeedsSummary persists JSON', () => {
    const { store } = setup();
    const s = store.createSession();
    store.setNeedsSummary(s.id, { mode: 'tool', topics: ['weekly'] });
    expect(store.getSession(s.id)?.needsSummary).toEqual({
      mode: 'tool',
      topics: ['weekly'],
    });
  });

  it('bindToApp validates the appId', () => {
    const { store } = setup();
    const s = store.createSession();
    store.bindToApp(s.id, 'demo-app');
    expect(store.getSession(s.id)?.appId).toBe('demo-app');
    expect(() => store.bindToApp(s.id, 'BAD')).toThrow();
  });
});

describe('SessionStore — messages', () => {
  it('appendMessage + listMessages preserves order', async () => {
    const { store } = setup();
    const s = store.createSession();
    store.appendMessage({
      sessionId: s.id,
      role: 'user',
      content: '我想做一个客户管理工具',
    });
    await new Promise((r) => setTimeout(r, 2));
    store.appendMessage({
      sessionId: s.id,
      role: 'assistant',
      content: { plan: 'list-detail' },
    });
    await new Promise((r) => setTimeout(r, 2));
    store.appendMessage({
      sessionId: s.id,
      role: 'tool',
      content: { ok: true },
      toolName: 'generate_manifest',
      tokensIn: 1234,
      tokensOut: 567,
    });
    const msgs = store.listMessages(s.id);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    expect(msgs[2].toolName).toBe('generate_manifest');
    expect(msgs[2].tokensIn).toBe(1234);
    expect(store.countMessages(s.id)).toBe(3);
  });

  it('appendMessage bumps session updated_at', async () => {
    const { store } = setup();
    const s = store.createSession();
    const t0 = store.getSession(s.id)?.updatedAt ?? 0;
    await new Promise((r) => setTimeout(r, 5));
    store.appendMessage({ sessionId: s.id, role: 'user', content: 'hi' });
    const t1 = store.getSession(s.id)?.updatedAt ?? 0;
    expect(t1).toBeGreaterThan(t0);
  });
});

describe('SessionStore — artifacts versioning', () => {
  it('saveArtifact bumps version per-file', () => {
    const { store } = setup();
    const s = store.createSession();
    const a1 = store.saveArtifact({
      sessionId: s.id,
      filePath: 'app.json',
      content: '{"v":1}',
    });
    const a2 = store.saveArtifact({
      sessionId: s.id,
      filePath: 'app.json',
      content: '{"v":2}',
    });
    const b1 = store.saveArtifact({
      sessionId: s.id,
      filePath: 'routes.json',
      content: '{"r":1}',
    });
    expect(a1.version).toBe(1);
    expect(a2.version).toBe(2);
    expect(b1.version).toBe(1);
  });

  it('getCurrentArtifacts returns the highest version per file', () => {
    const { store } = setup();
    const s = store.createSession();
    store.saveArtifact({
      sessionId: s.id,
      filePath: 'app.json',
      content: '{"v":1}',
    });
    store.saveArtifact({
      sessionId: s.id,
      filePath: 'app.json',
      content: '{"v":2}',
    });
    store.saveArtifact({
      sessionId: s.id,
      filePath: 'pages/main.json',
      content: '{"p":1}',
    });
    const current = store.getCurrentArtifacts(s.id);
    expect(current).toHaveLength(2);
    const byFile = Object.fromEntries(current.map((a) => [a.filePath, a]));
    expect(byFile['app.json'].content).toBe('{"v":2}');
    expect(byFile['pages/main.json'].content).toBe('{"p":1}');
  });

  it('listArtifactVersions returns newest first', () => {
    const { store } = setup();
    const s = store.createSession();
    for (let i = 1; i <= 3; i++) {
      store.saveArtifact({
        sessionId: s.id,
        filePath: 'app.json',
        content: `{"v":${i}}`,
      });
    }
    const versions = store.listArtifactVersions(s.id, 'app.json');
    expect(versions.map((a) => a.version)).toEqual([3, 2, 1]);
  });

  it('commitArtifacts marks all draft → committed', () => {
    const { store } = setup();
    const s = store.createSession();
    store.saveArtifact({
      sessionId: s.id,
      filePath: 'app.json',
      content: '{"v":1}',
    });
    store.saveArtifact({
      sessionId: s.id,
      filePath: 'routes.json',
      content: '{"r":1}',
    });
    expect(store.commitArtifacts(s.id)).toBe(2);
    // Second commit is a no-op.
    expect(store.commitArtifacts(s.id)).toBe(0);
    expect(
      store.getCurrentArtifacts(s.id).every((a) => a.status === 'committed'),
    ).toBe(true);
  });

  it('rollbackArtifact surfaces the previous version', () => {
    const { store } = setup();
    const s = store.createSession();
    store.saveArtifact({
      sessionId: s.id,
      filePath: 'pages/main.json',
      content: '{"v":1}',
    });
    store.saveArtifact({
      sessionId: s.id,
      filePath: 'pages/main.json',
      content: '{"v":2}',
    });
    expect(store.rollbackArtifact(s.id, 'pages/main.json')).toBe(true);
    const current = store.getCurrentArtifacts(s.id);
    expect(current[0].content).toBe('{"v":1}');
  });

  it('rollbackArtifact returns false when nothing to roll back', () => {
    const { store } = setup();
    const s = store.createSession();
    expect(store.rollbackArtifact(s.id, 'app.json')).toBe(false);
  });
});

describe('SessionStore — cascade with session deletion', () => {
  it('messages and artifacts cascade away when the session is deleted', () => {
    const { db, store } = setup();
    const s = store.createSession();
    store.appendMessage({ sessionId: s.id, role: 'user', content: 'hi' });
    store.saveArtifact({
      sessionId: s.id,
      filePath: 'app.json',
      content: '{}',
    });

    db.prepare('DELETE FROM lumos_app_builder_sessions WHERE id = ?').run(s.id);

    expect(
      (db
        .prepare('SELECT COUNT(*) AS c FROM lumos_app_builder_messages')
        .get() as { c: number }).c,
    ).toBe(0);
    expect(
      (db
        .prepare('SELECT COUNT(*) AS c FROM lumos_app_builder_artifacts')
        .get() as { c: number }).c,
    ).toBe(0);
  });
});
