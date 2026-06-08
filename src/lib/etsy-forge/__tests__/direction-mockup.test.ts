// 「按方向出图」两步法(印花→新印花→产品)守卫与选源:验收
//  - 第①步提示词按方向改图、要求出独立设计稿(不是 T);第②步提示词出 T 产品图
//  - 选源:默认原始印花,可选该商品的二创印花;非法兜底回印花;无印花返回 null
//  - 选了不存在/停用的方向 → 报错;商品没印花 → 报错;越权 → 报错
// 真实出图(调服务商)是集成范畴,这里只测到「进生成核心之前」的守卫逻辑,不 mock 服务商。

import Database from 'better-sqlite3';
import { migrateAppTables } from '../../db/migrations-app';
import { createAppDataStore, type AppDataStore } from '../../app/runtime/data-store';
import { buildDirectionDesignPrompt, buildDesignMockupPrompt, runDirectionMockup, resolveDirectionBase } from '../composer';
import { COLLECTIONS } from '../types';

const serve = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;

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

function makeProduct(store: AppDataStore): string {
  const p = store.create(COLLECTIONS.PRODUCTS, {
    user_id: U, keyword: 'k', source: 'etsy', listing_id: 'L1', title: 'Sunset Tee',
    url: 'https://etsy.com/listing/L1', main_image_url: 'https://img.etsy.com/L1.jpg',
    ehunt_status: 'idle', selected: false, detail_status: 'idle', detail_image_count: 0, created_at: new Date().toISOString(),
  });
  return p.id as string;
}
function addCutout(store: AppDataStore, productId: string, path: string): void {
  store.create(COLLECTIONS.CUTOUTS, { user_id: U, product_id: productId, source_count: 1, cutout_path: path, status: 'success', created_at: new Date().toISOString() });
}
function addRemixDesign(store: AppDataStore, productId: string, path: string): void {
  store.create(COLLECTIONS.ASSETS, { user_id: U, category: 'remix', product_id: productId, image_path: path, status: 'success', created_at: new Date().toISOString() });
}
function makeManualProduct(store: AppDataStore): string {
  const p = store.create(COLLECTIONS.MANUAL_PRODUCTS, { user_id: U, name: '手攒产品', created_at: new Date().toISOString() });
  return p.id as string;
}

describe('resolveDirectionBase（选源印花）', () => {
  it('没印花、没设计、没传 → null', () => {
    const store = setup();
    expect(resolveDirectionBase(store, U, makeProduct(store))).toBeNull();
  });

  it('有印花、没传 → 默认用原始印花', () => {
    const store = setup();
    const pid = makeProduct(store);
    addCutout(store, pid, '/tmp/cut1.png');
    expect(resolveDirectionBase(store, U, pid)).toBe(serve('/tmp/cut1.png'));
  });

  it('传了本商品的二创印花 → 用它当源', () => {
    const store = setup();
    const pid = makeProduct(store);
    addCutout(store, pid, '/tmp/cut1.png');
    addRemixDesign(store, pid, '/tmp/remix1.png');
    const chosen = serve('/tmp/remix1.png');
    expect(resolveDirectionBase(store, U, pid, chosen)).toBe(chosen);
  });

  it('传了不属于本商品的图(如产品图/外链)→ 兜底回原始印花', () => {
    const store = setup();
    const pid = makeProduct(store);
    addCutout(store, pid, '/tmp/cut1.png');
    expect(resolveDirectionBase(store, U, pid, serve('/tmp/not-mine.png'))).toBe(serve('/tmp/cut1.png'));
    expect(resolveDirectionBase(store, U, pid, 'https://img.etsy.com/L1.jpg')).toBe(serve('/tmp/cut1.png'));
  });
});

describe('direction prompts（两步)', () => {
  it('第①步:按方向改图 + 出独立设计稿(明确不是 T)', () => {
    const p = buildDirectionDesignPrompt({ label: '简约', profile: 'PROFILE_MARKER_minimalist restyle' });
    expect(p).toContain('PROFILE_MARKER_minimalist restyle');
    expect(p.toLowerCase()).toContain('standalone print design');
    expect(p.toLowerCase()).toContain('no t-shirt');
  });
  it('第②步:出 T 恤产品图 mockup', () => {
    const p = buildDesignMockupPrompt().toLowerCase();
    expect(p).toContain('t-shirt');
    expect(p).toContain('mockup');
  });
});

describe('runDirectionMockup（守卫)', () => {
  it('方向不存在/停用 → 报错,不出图', async () => {
    const store = setup();
    const r = await runDirectionMockup(store, { userId: U, productId: makeProduct(store), directionCode: 'ZZZ' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('不存在');
  });

  it('商品没有印花 → 报错(先抠印花)', async () => {
    const store = setup();
    // 'B' 是内置默认方向(listStrategies 自动播种),方向校验通过;卡在「没有印花」。
    const r = await runDirectionMockup(store, { userId: U, productId: makeProduct(store), directionCode: 'B' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('印花');
  });

  it('商品不属于该用户 → 报错', async () => {
    const store = setup();
    const r = await runDirectionMockup(store, { userId: 'someone-else', productId: makeProduct(store), directionCode: 'B' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('商品不存在');
  });

  it('手攒产品(MANUAL_PRODUCTS)也认归属——不报「商品不存在」', async () => {
    const store = setup();
    // 用不存在的方向,归属过了就该卡在方向校验,而不是「商品不存在」。
    const r = await runDirectionMockup(store, { userId: U, productId: makeManualProduct(store), directionCode: 'ZZZ' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('不存在');
    expect(r.error).not.toContain('商品');
  });
});
