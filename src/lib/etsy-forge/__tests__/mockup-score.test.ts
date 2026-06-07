// 产品图打分:验收 clamp(1-10/0 清除)+ 归属校验 + 落库。

import Database from 'better-sqlite3';
import { migrateAppTables } from '../../db/migrations-app';
import { createAppDataStore, type AppDataStore } from '../../app/runtime/data-store';
import { clampScore, setMockupScore } from '../mockup-score';
import { COLLECTIONS, type MockupRow } from '../types';

function setup(): AppDataStore {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('etsy-forge', 'etsy-forge', '1.0.0', '{}', 'builtin', '/tmp/etsy-forge', Date.now());
  return createAppDataStore(db, 'etsy-forge');
}
const U = 'u1';
function addMockup(store: AppDataStore): string {
  const m = store.create(COLLECTIONS.MOCKUPS, { user_id: U, image_path: '/tmp/m.png', status: 'success', created_at: new Date().toISOString() });
  return m.id as string;
}

describe('clampScore', () => {
  it('收敛到 [0,10] 整数,非数字按 0', () => {
    expect(clampScore(7)).toBe(7);
    expect(clampScore(0)).toBe(0);
    expect(clampScore(15)).toBe(10);
    expect(clampScore(-3)).toBe(0);
    expect(clampScore(7.6)).toBe(8);
    expect(clampScore('abc')).toBe(0);
    expect(clampScore(undefined)).toBe(0);
  });
});

describe('setMockupScore', () => {
  it('打分落库,返回收敛后的分', () => {
    const store = setup();
    const id = addMockup(store);
    const r = setMockupScore(store, U, id, 8);
    expect(r).toEqual({ ok: true, score: 8 });
    expect(store.get<MockupRow>(COLLECTIONS.MOCKUPS, id)?.score).toBe(8);
  });

  it('0 清除评分', () => {
    const store = setup();
    const id = addMockup(store);
    setMockupScore(store, U, id, 9);
    setMockupScore(store, U, id, 0);
    expect(store.get<MockupRow>(COLLECTIONS.MOCKUPS, id)?.score).toBe(0);
  });

  it('超范围被 clamp', () => {
    const store = setup();
    const id = addMockup(store);
    expect(setMockupScore(store, U, id, 99).score).toBe(10);
  });

  it('不属于该用户 / 不存在 → 报错', () => {
    const store = setup();
    const id = addMockup(store);
    expect(setMockupScore(store, 'other', id, 5).ok).toBe(false);
    expect(setMockupScore(store, U, 'nope', 5).ok).toBe(false);
  });
});
