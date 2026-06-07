// 「图→产品」引擎 + 默认空白 T:验收守卫与复用路径。
// 真实出图(文生图/二创/合成)是集成范畴,这里只测「进生成核心之前」的逻辑,不 mock 服务商。

import Database from 'better-sqlite3';
import { migrateAppTables } from '../../db/migrations-app';
import { createAppDataStore, type AppDataStore } from '../../app/runtime/data-store';
import { DEFAULT_BLANK_TEE_MARKER, findDefaultBlankTee, getOrCreateDefaultBlankTee } from '../default-blank-tee';
import { makeProductFromImage } from '../image-to-product';
import { COLLECTIONS } from '../types';

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
function addBlankTee(store: AppDataStore, path: string): string {
  const a = store.create(COLLECTIONS.ASSETS, { user_id: U, category: 'product', description: DEFAULT_BLANK_TEE_MARKER, image_path: path, status: 'success', created_at: new Date().toISOString() });
  return a.id as string;
}

describe('default-blank-tee', () => {
  it('没有默认空白 T → null', () => {
    expect(findDefaultBlankTee(setup(), U)).toBeNull();
  });

  it('有标记素材 → 找到', () => {
    const store = setup();
    const id = addBlankTee(store, '/tmp/tee.png');
    expect(findDefaultBlankTee(store, U)?.id).toBe(id);
  });

  it('getOrCreate:已有就直接返回(不生成)', async () => {
    const store = setup();
    const id = addBlankTee(store, '/tmp/tee.png');
    await expect(getOrCreateDefaultBlankTee(store, U)).resolves.toEqual({ assetId: id });
  });

  it('普通 product 素材(无标记)不当默认空白 T', () => {
    const store = setup();
    store.create(COLLECTIONS.ASSETS, { user_id: U, category: 'product', description: '某产品的空白T', image_path: '/tmp/x.png', status: 'success', created_at: new Date().toISOString() });
    expect(findDefaultBlankTee(store, U)).toBeNull();
  });
});

describe('makeProductFromImage（守卫)', () => {
  it('没传图 → 报错', async () => {
    const r = await makeProductFromImage(setup(), U, {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('没有图片');
  });

  it('图读不出/没服务商 → 报错,且不建手攒产品', async () => {
    // 注:测试环境可能读到本机配置的图片服务商,所以不断言具体错误文案;
    // 关键不变量:失败(用不存在的本地图)且不会残留半个手攒产品。
    const store = setup();
    const r = await makeProductFromImage(store, U, { imagePath: '/tmp/does-not-exist.png' });
    expect(r.ok).toBe(false);
    expect(store.query(COLLECTIONS.MANUAL_PRODUCTS, { filter: { user_id: U }, limit: 10 }).length).toBe(0);
  });
});
