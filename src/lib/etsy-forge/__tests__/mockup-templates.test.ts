// T恤模板管理单测:内置 seed(拷贝底图进媒体目录)、print_area 清洗、内置不可删、启停过滤。
// LUMOS_DATA_DIR 指向临时目录,不碰真实 ~/.lumos。

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { migrateAppTables } from '../../db/migrations-app';
import { createAppDataStore, type AppDataStore } from '../../app/runtime/data-store';

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'mockup-tpl-test-'));
process.env.LUMOS_DATA_DIR = tmpData;

// env 设置后再 import 被测模块(它读 LUMOS_DATA_DIR)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createTemplate, deleteTemplate, listEnabledTemplates, listTemplates, updateTemplate } = require('../mockup-templates') as typeof import('../mockup-templates');

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
// 真实可解码的 PNG(sharp 生成 64x64 纯色),createTemplate 有服务端解码探测
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as typeof import('sharp');
let VALID_PNG_B64 = '';
beforeAll(async () => {
  // 噪声图:纯色 PNG 压缩后会低于 1KB 下限,噪声压不动,稳过大小校验
  const size = 64;
  const raw = Buffer.alloc(size * size * 4);
  let seed = 7;
  for (let i = 0; i < raw.length; i++) raw[i] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  const buf = await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  VALID_PNG_B64 = buf.toString('base64');
});

afterAll(() => {
  fs.rmSync(tmpData, { recursive: true, force: true });
});

describe('mockup-templates', () => {
  it('首次 list 自动 seed 内置白/黑模板,底图被拷进媒体目录且文件存在;重复 list 不再 seed', () => {
    const store = setupStore();
    const first = listTemplates(store, USER);
    expect(first.length).toBe(2);
    for (const t of first) {
      expect(t.builtin).toBe(true);
      expect(t.enabled).toBe(true);
      expect(t.base_path.startsWith(path.join(tmpData, '.lumos-media'))).toBe(true);
      expect(fs.existsSync(t.base_path)).toBe(true);
      expect(t.print_area.w).toBeGreaterThan(0);
    }
    expect(listTemplates(store, USER).length).toBe(2);
  });

  it('上传创建:底图落盘、print_area 缺省有兜底;停用后不进 listEnabledTemplates', async () => {
    const store = setupStore();
    const t = await createTemplate(store, USER, { name: '自家白T', baseImageBase64: VALID_PNG_B64 });
    expect(fs.existsSync(t.base_path)).toBe(true);
    expect(t.print_area).toEqual({ x: 660, y: 500, w: 730, h: 880 });

    updateTemplate(store, USER, t.id, { enabled: false });
    expect(listEnabledTemplates(store, USER).some((x) => x.id === t.id)).toBe(false);
  });

  it('print_area 清洗:负数归零、过小宽高抬到 50', async () => {
    const store = setupStore();
    const t = await createTemplate(store, USER, { name: 'x', baseImageBase64: VALID_PNG_B64, printArea: { x: -5, y: 3.7, w: 1, h: 0 } });
    expect(t.print_area).toEqual({ x: 0, y: 4, w: 50, h: 50 });
  });

  it('内置模板不可删(可停用),用户模板删除时底图文件一并清理', async () => {
    const store = setupStore();
    const builtin = listTemplates(store, USER).find((t) => t.builtin);
    expect(builtin).toBeDefined();
    expect(() => deleteTemplate(store, USER, builtin!.id)).toThrow('内置模板不可删');

    const mine = await createTemplate(store, USER, { name: '删我', baseImageBase64: VALID_PNG_B64 });
    const file = mine.base_path;
    deleteTemplate(store, USER, mine.id);
    expect(listTemplates(store, USER).some((t) => t.id === mine.id)).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('底图太小/非图片/空名 都在上传时拒绝', async () => {
    const store = setupStore();
    await expect(createTemplate(store, USER, { name: 'x', baseImageBase64: Buffer.from('tiny').toString('base64') })).rejects.toThrow('底图无效');
    await expect(createTemplate(store, USER, { name: 'x', baseImageBase64: Buffer.alloc(4096, 7).toString('base64') })).rejects.toThrow('不是可解码的图片');
    await expect(createTemplate(store, USER, { name: ' ', baseImageBase64: VALID_PNG_B64 })).rejects.toThrow('模板名不能为空');
  });
});
