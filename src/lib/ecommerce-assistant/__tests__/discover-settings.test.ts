import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore } from '@/lib/app/runtime/data-store';

import {
  getBrowserFetchSettings,
  setBrowserFetchSettings,
} from '../discover-settings';

const APP_ID = 'ecommerce-assistant';
const originalDataDir = process.env.LUMOS_DATA_DIR;

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(APP_ID, APP_ID, '0.1.0', '{}', 'builtin', '/tmp/' + APP_ID, Date.now());
  return db;
}

describe('browser fetch settings', () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAppDataStore>;

  beforeEach(() => {
    db = setupDb();
    store = createAppDataStore(db, APP_ID);
  });
  afterEach(() => db.close());
  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = originalDataDir;
    }
  });

  it('returns sensible defaults when nothing is stored', () => {
    const out = getBrowserFetchSettings(store);
    expect(out.enabled).toBe(true);
    expect(out.browserContextId).toBe('embedded:default');
  });

  it('defaults to the first enabled Lumos browser provider runtime context when available', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-browser-runtime-'));
    process.env.LUMOS_DATA_DIR = dir;
    fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'runtime', 'browser-providers.json'),
      JSON.stringify({
        configs: [
          {
            id: 'browser-1',
            providerType: 'adspower',
            enabled: true,
            profileId: 'k1c1fbjj',
          },
        ],
      }),
      'utf-8',
    );

    const out = getBrowserFetchSettings(store);

    expect(out.enabled).toBe(true);
    expect(out.browserContextId).toBe('adspower:k1c1fbjj');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('persists and reads back', () => {
    setBrowserFetchSettings(store, {
      enabled: true,
      browserContextId: 'adspower:kabc123',
    });
    const out = getBrowserFetchSettings(store);
    expect(out.enabled).toBe(true);
    expect(out.browserContextId).toBe('adspower:kabc123');
  });

  it('normalizes an empty browser context to the embedded browser', () => {
    const out = setBrowserFetchSettings(store, {
      enabled: true,
      browserContextId: '   ',
    });
    expect(out.enabled).toBe(true);
    expect(out.browserContextId).toBe('embedded:default');
  });

  it('upserts (only one row per key, no duplicates)', () => {
    setBrowserFetchSettings(store, { browserContextId: 'adspower:a' });
    setBrowserFetchSettings(store, { browserContextId: 'adspower:b' });
    setBrowserFetchSettings(store, { browserContextId: 'adspower:c', enabled: true });
    const rows = store.query('app_settings', { limit: 100 });
    // single row for our key
    const ours = rows.filter((r) => (r as { key?: string }).key === 'ecommerce.discover.browser_fetch');
    expect(ours).toHaveLength(1);
    const out = getBrowserFetchSettings(store);
    expect(out.browserContextId).toBe('adspower:c');
    expect(out.enabled).toBe(true);
  });

  it('survives a corrupted stored value', () => {
    store.create('app_settings', {
      key: 'ecommerce.discover.browser_fetch',
      value: 'not json{{{',
    });
    const out = getBrowserFetchSettings(store);
    expect(out.enabled).toBe(true);
    expect(out.browserContextId).toBe('embedded:default');
  });

  it('migrates legacy AdsPower profile settings to a Lumos browser context', () => {
    store.create('app_settings', {
      key: 'ecommerce.discover.ads_power',
      value: JSON.stringify({
        enabled: true,
        apiBase: 'http://local.adspower.net:50325',
        profileId: 'klegacy123',
        apiKey: 'secret',
      }),
    });
    const out = getBrowserFetchSettings(store);
    expect(out.enabled).toBe(true);
    expect(out.browserContextId).toBe('adspower:klegacy123');
  });
});
