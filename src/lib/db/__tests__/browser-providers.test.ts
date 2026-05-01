import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

let db: Database.Database;

jest.mock('../connection', () => ({
  getDb: () => db,
}));

import {
  BrowserProviderInUseError,
  createBrowserProviderConfig,
  deleteBrowserProviderConfig,
  getBrowserProviderConfigRaw,
  previewAdsPowerBrowserProfileSync,
  syncAdsPowerBrowserProfiles,
  updateBrowserProviderConfig,
} from '../browser-providers';

function createTables() {
  db.exec(`
    CREATE TABLE browser_provider_configs (
      id TEXT PRIMARY KEY,
      provider_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      api_base_url TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      cdp_endpoint TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL DEFAULT '',
      profile_name TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      last_test_status TEXT NOT NULL DEFAULT 'untested',
      last_test_message TEXT NOT NULL DEFAULT '',
      last_profile_count INTEGER NOT NULL DEFAULT 0,
      last_tested_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY,
      browser_context_id TEXT NOT NULL DEFAULT 'embedded:default'
    );

    CREATE TABLE scheduled_workflows (
      id TEXT PRIMARY KEY,
      browser_context_id TEXT NOT NULL DEFAULT 'embedded:default',
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE browser_profile_aliases (
      id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(config_id, alias)
    );
  `);
}

describe('browser provider config persistence guards', () => {
  let dataDir: string;
  const originalDataDir = process.env.LUMOS_DATA_DIR;

  beforeEach(() => {
    db = new Database(':memory:');
    createTables();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-browser-providers-'));
    process.env.LUMOS_DATA_DIR = dataDir;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = originalDataDir;
    }
  });

  test('requires runnable fields before enabling a provider config', () => {
    expect(() => createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '浏览器1',
      enabled: true,
    })).toThrow(/Profile ID/);

    expect(() => createBrowserProviderConfig({
      provider_type: 'external-cdp',
      display_name: '外部浏览器',
      enabled: true,
    })).toThrow(/DevTools/);
  });

  test('persists normalized profile aliases for matching configured browsers', () => {
    const config = createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: 'AdsPower profile',
      enabled: true,
      profile_id: 'k1c1fbjj',
      aliases: ['浏览器1', ' 店铺A ', '浏览器1', ''],
    });

    expect(config.aliases).toEqual(['浏览器1', '店铺A']);

    const updated = updateBrowserProviderConfig(config.id, {
      aliases: ['知乎账号', '浏览器1'],
    });
    expect(updated.aliases).toEqual(['知乎账号', '浏览器1']);
  });

  test('rejects duplicate AdsPower profile contexts', () => {
    createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '浏览器1',
      profile_id: 'k1c1fbjj',
    });

    expect(() => createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '浏览器1 副本',
      profile_id: 'k1c1fbjj',
    })).toThrow('上下文 adspower:k1c1fbjj 已存在');
  });

  test('allows multiple disabled AdsPower drafts before profile binding', () => {
    const first = createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '待绑定 1',
      enabled: false,
    });
    const second = createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '待绑定 2',
      enabled: false,
    });

    expect(first.profile_id).toBe('');
    expect(second.profile_id).toBe('');
  });

  test('rejects updates that would duplicate an AdsPower profile context', () => {
    createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '浏览器1',
      profile_id: 'k1c1fbjj',
    });
    const config = createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '浏览器2',
      profile_id: 'other-profile',
    });

    expect(() => updateBrowserProviderConfig(config.id, { profile_id: 'k1c1fbjj' }))
      .toThrow('上下文 adspower:k1c1fbjj 已存在');
  });

  test('blocks disabling or deleting a provider that is still referenced', () => {
    const config = createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '浏览器1',
      enabled: true,
      profile_id: 'k1c1fbjj',
    });

    db.prepare('INSERT INTO chat_sessions (id, browser_context_id) VALUES (?, ?)').run('chat-1', config.context_id);
    db.prepare('INSERT INTO scheduled_workflows (id, browser_context_id, enabled) VALUES (?, ?, ?)').run('schedule-1', config.context_id, 1);

    expect(() => updateBrowserProviderConfig(config.id, { enabled: false }))
      .toThrow(BrowserProviderInUseError);
    expect(() => deleteBrowserProviderConfig(config.id))
      .toThrow(BrowserProviderInUseError);
  });

  test('blocks changing AdsPower profile id when existing references would become stale', () => {
    const config = createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '浏览器1',
      enabled: true,
      profile_id: 'k1c1fbjj',
    });
    db.prepare('INSERT INTO scheduled_workflows (id, browser_context_id, enabled) VALUES (?, ?, ?)').run('schedule-1', config.context_id, 0);

    expect(() => updateBrowserProviderConfig(config.id, { profile_id: 'another-profile' }))
      .toThrow(BrowserProviderInUseError);
  });

  test('syncs AdsPower profiles by creating missing configs and refreshing metadata', () => {
    const existing = createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '自定义浏览器',
      enabled: true,
      profile_id: 'profile-1',
      profile_name: '旧名称',
      notes: '人工备注',
    });

    const result = syncAdsPowerBrowserProfiles({
      api_base_url: 'http://127.0.0.1:50325',
      profiles: [
        { id: 'profile-1', name: '新名称', group: 'A组', serial_number: '17' },
        { id: 'profile-2', name: '店铺2', group: 'B组', serial_number: '18' },
      ],
    });

    expect(result.updated).toHaveLength(1);
    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    const updated = getBrowserProviderConfigRaw(existing.id);
    expect(updated?.display_name).toBe('自定义浏览器');
    expect(updated?.profile_name).toBe('新名称');
    expect(updated?.notes).toContain('AdsPower 分组: A组');
    expect(updated?.notes).toContain('AdsPower 序号: 17');
    expect(updated?.notes).toContain('人工备注');
    expect(result.created[0]?.context_id).toBe('adspower:profile-2');
    expect(result.created[0]?.notes).toContain('AdsPower 分组: B组');
  });

  test('previews AdsPower sync changes without mutating configs', () => {
    const existing = createBrowserProviderConfig({
      provider_type: 'adspower',
      display_name: '浏览器1',
      enabled: true,
      profile_id: 'profile-1',
      profile_name: '旧名称',
      notes: 'AdsPower 分组: 老分组\n人工备注',
    });

    const plan = previewAdsPowerBrowserProfileSync({
      api_base_url: 'http://127.0.0.1:50325',
      profiles: [
        { id: 'profile-1', name: '新名称', group: '新分组', serial_number: '9' },
        { id: 'profile-2', name: '浏览器2', group: '新分组' },
      ],
    });

    expect(plan.map((item) => item.action)).toEqual(['update', 'create']);
    expect(plan[0]?.changes.join('\n')).toContain('Profile 名称');
    expect(plan[0]?.changes.join('\n')).toContain('分组');
    expect(plan[1]?.changes).toContain('新增浏览器配置');

    const unchanged = getBrowserProviderConfigRaw(existing.id);
    expect(unchanged?.profile_name).toBe('旧名称');
    expect(unchanged?.notes).toContain('老分组');
  });
});
