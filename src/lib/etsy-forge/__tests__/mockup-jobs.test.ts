// 单发出图运行记录(微调 / 按方向出图):验收
//  - start→finish:running 转 success/failed,带原因
//  - 列表映射 kind_cn(微调/按方向出图)+ 解析产品标题
//  - stale running(>15min)不显示;fresh running 和终态都显示
//  - 只列本用户 + 近 20 条封顶

import Database from 'better-sqlite3';
import { migrateAppTables } from '../../db/migrations-app';
import { createAppDataStore, type AppDataStore } from '../../app/runtime/data-store';
import { startMockupJob, finishMockupJob, listMockupJobsForDock } from '../mockup-jobs';
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

function makeProduct(store: AppDataStore, title = 'Sunset Tee'): string {
  const p = store.create(COLLECTIONS.PRODUCTS, {
    user_id: U, keyword: 'k', source: 'etsy', listing_id: 'L1', title, url: 'u', main_image_url: 'i',
    ehunt_status: 'idle', selected: false, detail_status: 'idle', detail_image_count: 0, created_at: new Date().toISOString(),
  });
  return p.id as string;
}
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('mockup-jobs', () => {
  it('start→finish:running 转 success,映射「按方向出图」+ 解析标题/细节', () => {
    const store = setup();
    const pid = makeProduct(store);
    const jobId = startMockupJob(store, { userId: U, kind: 'direction', productId: pid, label: '简约' });
    let rows = listMockupJobsForDock(store, U);
    expect(rows[0].status).toBe('running');
    expect(rows[0].kind_cn).toBe('按方向出图');
    expect(rows[0].title).toBe('Sunset Tee');
    expect(rows[0].label).toBe('简约');
    finishMockupJob(store, jobId, true);
    rows = listMockupJobsForDock(store, U);
    expect(rows[0].status).toBe('success');
  });

  it('compose 映射「微调」,失败带原因', () => {
    const store = setup();
    const pid = makeProduct(store);
    const jobId = startMockupJob(store, { userId: U, kind: 'compose', productId: pid, label: '印到深色T' });
    finishMockupJob(store, jobId, false, '服务商超时');
    const r = listMockupJobsForDock(store, U)[0];
    expect(r.kind_cn).toBe('微调');
    expect(r.status).toBe('failed');
    expect(r.failure_reason).toBe('服务商超时');
  });

  it('stale running(>15min)丢弃;fresh running 和老的终态都留', () => {
    const store = setup();
    const pid = makeProduct(store);
    store.create(COLLECTIONS.MOCKUP_JOBS, { user_id: U, kind: 'direction', product_id: pid, label: '旧', status: 'running', created_at: ago(20 * 60 * 1000) });
    store.create(COLLECTIONS.MOCKUP_JOBS, { user_id: U, kind: 'compose', product_id: pid, label: '新', status: 'running', created_at: ago(0) });
    store.create(COLLECTIONS.MOCKUP_JOBS, { user_id: U, kind: 'compose', product_id: pid, label: '完', status: 'success', created_at: ago(30 * 60 * 1000) });
    const labels = listMockupJobsForDock(store, U).map((r) => r.label);
    expect(labels).toContain('新');
    expect(labels).toContain('完');
    expect(labels).not.toContain('旧');
  });

  it('只列本用户 + 近 20 条封顶', () => {
    const store = setup();
    const pid = makeProduct(store);
    for (let i = 0; i < 25; i++) startMockupJob(store, { userId: U, kind: 'compose', productId: pid, label: `#${i}` });
    startMockupJob(store, { userId: 'other', kind: 'compose', productId: pid, label: '别人' });
    const rows = listMockupJobsForDock(store, U);
    expect(rows.length).toBe(20);
    expect(rows.every((r) => r.label !== '别人')).toBe(true);
  });
});
