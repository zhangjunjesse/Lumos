// P1 回归:sharp 模板合成的 mockup 行(只有 template_id)必须能真正重试——
// review 抓到旧 retry 路由把它错分给 composer 分支导致永久失败。这里锁住
// retryTemplateMockup 的成功/各失败前置,以及 composeMockupRecord 的落库形状。

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { migrateAppTables } from '../../db/migrations-app';
import { createAppDataStore, type AppDataStore } from '../../app/runtime/data-store';
import { COLLECTIONS, type MockupRow } from '../types';

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-compose-test-'));
process.env.LUMOS_DATA_DIR = tmpData;

// env 设置后再 import 被测模块(mediaDir 读 LUMOS_DATA_DIR)
/* eslint-disable @typescript-eslint/no-require-imports */
const { composeMockupRecord, retryTemplateMockup } = require('../mockup-compose') as typeof import('../mockup-compose');
const { createTemplate } = require('../mockup-templates') as typeof import('../mockup-templates');
const sharp = require('sharp') as typeof import('sharp');
/* eslint-enable @typescript-eslint/no-require-imports */

function setupStore(): AppDataStore {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('etsy-forge', 'etsy-forge', '1.0.0', '{}', 'builtin', '/tmp/etsy-forge', Date.now());
  return createAppDataStore(db, 'etsy-forge');
}

const USER = 'u1';

async function makePng(name: string, color: { r: number; g: number; b: number }, size = 80): Promise<string> {
  const file = path.join(tmpData, name);
  await sharp({ create: { width: size, height: size, channels: 4, background: { ...color, alpha: 1 } } }).png().toFile(file);
  return file;
}

async function makeUserTemplate(store: AppDataStore) {
  const buf = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 240, g: 240, b: 240, alpha: 1 } } }).png().toBuffer();
  return createTemplate(store, USER, { name: '测试模板', baseImageBase64: buf.toString('base64'), printArea: { x: 50, y: 50, w: 100, h: 100 } });
}

afterAll(() => {
  fs.rmSync(tmpData, { recursive: true, force: true });
});

describe('composeMockupRecord', () => {
  it('成功:写 success 行(带 template_id/design_ref/image_path,产物文件存在)', async () => {
    const store = setupStore();
    const tpl = await makeUserTemplate(store);
    const printPath = await makePng('print-a.png', { r: 200, g: 30, b: 30 });
    const print = await sharp(printPath).png().toBuffer();

    const ok = await composeMockupRecord(store, USER, { print, template: tpl, designRef: printPath, sourceProductId: 'p1' });
    expect(ok).toBe(true);
    const row = store.query<MockupRow>(COLLECTIONS.MOCKUPS, { filter: { user_id: USER }, limit: 10 })[0];
    expect(row.status).toBe('success');
    expect(row.template_id).toBe(tpl.id);
    expect(row.product_asset_id).toBeFalsy(); // 新行不再有旧 inpaint 字段
    expect(fs.existsSync(row.image_path!)).toBe(true);
  });

  it('失败(模板底图文件丢失):写 failed 行带原因,不 throw', async () => {
    const store = setupStore();
    const tpl = await makeUserTemplate(store);
    fs.unlinkSync(tpl.base_path);
    const ok = await composeMockupRecord(store, USER, { print: Buffer.from('not-an-image'), template: tpl, designRef: '/x.png' });
    expect(ok).toBe(false);
    const row = store.query<MockupRow>(COLLECTIONS.MOCKUPS, { filter: { user_id: USER }, limit: 10 })[0];
    expect(row.status).toBe('failed');
    expect(row.failure_reason).toBeTruthy();
  });
});

describe('retryTemplateMockup (P1 回归)', () => {
  it('成功路径:failed 行重试后翻成 success、换新产物文件', async () => {
    const store = setupStore();
    const tpl = await makeUserTemplate(store);
    const printPath = await makePng('print-b.png', { r: 30, g: 30, b: 200 });
    const failedRow = store.create(COLLECTIONS.MOCKUPS, {
      user_id: USER,
      design_ref: printPath,
      template_id: tpl.id,
      status: 'failed',
      failure_reason: '上次挂了',
      created_at: new Date().toISOString(),
    }) as unknown as MockupRow;

    await retryTemplateMockup(store, USER, failedRow);
    const row = store.get<MockupRow>(COLLECTIONS.MOCKUPS, failedRow.id)!;
    expect(row.status).toBe('success');
    expect(row.failure_reason).toBe('');
    expect(fs.existsSync(row.image_path!)).toBe(true);
  });

  it('印花源文件不存在/模板已删:失败原因如实写回原行', async () => {
    const store = setupStore();
    const tpl = await makeUserTemplate(store);

    const noPrint = store.create(COLLECTIONS.MOCKUPS, {
      user_id: USER, design_ref: '/gone.png', template_id: tpl.id, status: 'failed', created_at: new Date().toISOString(),
    }) as unknown as MockupRow;
    await retryTemplateMockup(store, USER, noPrint);
    expect(store.get<MockupRow>(COLLECTIONS.MOCKUPS, noPrint.id)!.failure_reason).toContain('印花源文件不存在');

    const printPath = await makePng('print-c.png', { r: 10, g: 200, b: 10 });
    const noTpl = store.create(COLLECTIONS.MOCKUPS, {
      user_id: USER, design_ref: printPath, template_id: 'deleted-tpl', status: 'failed', created_at: new Date().toISOString(),
    }) as unknown as MockupRow;
    await retryTemplateMockup(store, USER, noTpl);
    expect(store.get<MockupRow>(COLLECTIONS.MOCKUPS, noTpl.id)!.failure_reason).toContain('模板已删除');
  });
});
