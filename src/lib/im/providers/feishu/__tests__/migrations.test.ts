const store = new Map<string, string>();
jest.mock('@/lib/db', () => ({
  getSetting: (key: string) => store.get(key),
  setSetting: (key: string, value: string) => {
    store.set(key, value);
  },
}));

import { runFeishuMigrations } from '../migrations';

beforeEach(() => {
  store.clear();
});

describe('feishu/migrations', () => {
  test('copies legacy keys to im.feishu.* namespace', () => {
    store.set('feishu_app_id', 'cli_x');
    store.set('feishu_app_secret', 'sec_y');
    store.set('feishu_redirect_uri', 'https://x/cb');
    store.set('feishu_oauth_scopes', 'a b');

    runFeishuMigrations();

    expect(store.get('im.feishu.app_id')).toBe('cli_x');
    expect(store.get('im.feishu.app_secret')).toBe('sec_y');
    expect(store.get('im.feishu.redirect_uri')).toBe('https://x/cb');
    expect(store.get('im.feishu.oauth_scopes')).toBe('a b');
  });

  test('preserves legacy keys (does not delete)', () => {
    store.set('feishu_app_id', 'cli_x');
    runFeishuMigrations();
    expect(store.get('feishu_app_id')).toBe('cli_x');
  });

  test('is idempotent — second run does not overwrite manual edits', () => {
    store.set('feishu_app_id', 'cli_x');
    runFeishuMigrations();
    // Manually edit the new namespace to simulate post-migration changes
    store.set('im.feishu.app_id', 'manually_edited');
    runFeishuMigrations();
    expect(store.get('im.feishu.app_id')).toBe('manually_edited');
  });

  test('skips empty legacy values', () => {
    store.set('feishu_app_id', '');
    runFeishuMigrations();
    expect(store.has('im.feishu.app_id')).toBe(false);
  });

  test('marks migration as applied', () => {
    runFeishuMigrations();
    expect(store.get('im.migration.feishu-2026-04-01')).toBe('1');
  });
});
