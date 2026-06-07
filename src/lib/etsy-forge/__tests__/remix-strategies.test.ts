// 二创方向策略(动态 DB):验收
//  - 首次自动播种 A/B/C/D,默认是 B
//  - 不传方向 → 用默认(B)
//  - 传方向 → 按 code 取
//  - 非自有图 → 跳过高相似策略(A);若全是高相似则保留(总比不出强)

import Database from 'better-sqlite3';
import { migrateAppTables } from '../../db/migrations-app';
import { createAppDataStore, type AppDataStore } from '../../app/runtime/data-store';
import { listStrategies, resolveDirections } from '../remix-strategies';

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

describe('remix-strategies', () => {
  it('首次自动播种 A/B/C/D + E4-E8 + S1,默认 B', () => {
    const store = setup();
    const all = listStrategies(store, U);
    expect(all.map((s) => s.code).sort()).toEqual(['A', 'B', 'C', 'D', 'E4', 'E5', 'E6', 'E7', 'E8', 'S1']);
    expect(all.filter((s) => s.is_default).map((s) => s.code)).toEqual(['B']);
  });

  it('不传方向 → 用默认 B', () => {
    const store = setup();
    const dirs = resolveDirections(store, U, undefined, false);
    expect(dirs.map((d) => d.key)).toEqual(['B']);
  });

  it('传方向 → 按 code 取', () => {
    const store = setup();
    expect(resolveDirections(store, U, ['A', 'C'], false).map((d) => d.key).sort()).toEqual(['A', 'C']);
  });

  it('非自有图 → 跳过高相似的 A,留 B', () => {
    const store = setup();
    expect(resolveDirections(store, U, ['A', 'B'], true).map((d) => d.key)).toEqual(['B']);
  });

  it('非自有图但只选了高相似 A → 保留(总比不出强)', () => {
    const store = setup();
    expect(resolveDirections(store, U, ['A'], true).map((d) => d.key)).toEqual(['A']);
  });
});
