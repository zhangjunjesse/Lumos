import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';

import { recordDefaultUserImTarget } from '../im-bridge';
import { createAppDataStore } from '../runtime/data-store';
import { computeNativeStatus, getNativeAppStatus } from '../status-service';

function setup(
  specPatch: Record<string, unknown> = {},
  manifestPatch: Record<string, unknown> = {},
) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  const installPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-app-status-'));
  const manifest = {
    id: 'native-demo',
    name: 'Native Demo',
    version: '1.0.0',
    icon: './icon.png',
    entry: 'status',
    permissions: { data: 'isolated' },
    ...manifestPatch,
  };
  const spec = {
    version: 1,
    status: {
      readyCriteria: ['设置已保存。'],
      notConnectedBehavior: '缺底层能力时显示未接入。',
    },
    automations: { enabled: false },
    im: { enabled: false },
    ...specPatch,
  };
  fs.writeFileSync(path.join(installPath, 'native-app-spec.json'), JSON.stringify(spec));
  db.prepare(
    `INSERT INTO lumos_app_apps
      (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('native-demo', 'Native Demo', '1.0.0', JSON.stringify(manifest), 'ai-generated', installPath, 1);

  return {
    db,
    installPath,
    store: createAppDataStore(db, 'native-demo'),
    cleanup: () => fs.rmSync(installPath, { recursive: true, force: true }),
  };
}

function grantImBridge(env: ReturnType<typeof setup>) {
  env.db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  env.db.prepare(
    `INSERT INTO lumos_app_permissions (app_id, permission, granted, granted_at)
     VALUES (?, ?, ?, ?)`,
  ).run('native-demo', 'system:im-notification', 1, 1);
  recordDefaultUserImTarget({
    providerId: 'wechat',
    chatId: 'wx-user',
    source: 'wechat-inbound',
  }, env.db);
}

describe('computeNativeStatus', () => {
  it('orders running, missing capabilities, configuration, failure, ready', () => {
    expect(computeNativeStatus({
      settingsCount: 1,
      runningRuns: 1,
      missingCapabilities: ['x'],
    })).toBe('running');
    expect(computeNativeStatus({
      settingsCount: 1,
      runningRuns: 0,
      missingCapabilities: ['x'],
    })).toBe('not_connected');
    expect(computeNativeStatus({
      settingsCount: 0,
      runningRuns: 0,
      missingCapabilities: [],
    })).toBe('not_configured');
    expect(computeNativeStatus({
      settingsCount: 1,
      runningRuns: 0,
      latestRunStatus: 'failed',
      missingCapabilities: [],
    })).toBe('failed');
    expect(computeNativeStatus({
      settingsCount: 1,
      runningRuns: 0,
      latestRunStatus: 'success',
      missingCapabilities: [],
    })).toBe('ready');
  });
});

describe('getNativeAppStatus', () => {
  it('reports not_configured before settings are saved', () => {
    const env = setup();
    try {
      const status = getNativeAppStatus(env.db, 'native-demo', { now: 123 });
      expect(status?.status).toBe('not_configured');
      expect(status?.counts.settings).toBe(0);
      expect(status?.readyCriteria).toEqual(['设置已保存。']);
    } finally {
      env.cleanup();
    }
  });

  it('reports ready after settings exist', () => {
    const env = setup();
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('ready');
      expect(status?.counts.settings).toBe(1);
    } finally {
      env.cleanup();
    }
  });

  it('reports running when an engine run is active', () => {
    const env = setup();
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      env.db.prepare(
        `INSERT INTO lumos_app_runs
          (id, app_id, triggered_by, status, started_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('run-1', 'native-demo', 'manual', 'running', 1000);
      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('running');
      expect(status?.latestRun?.source).toBe('app_run');
    } finally {
      env.cleanup();
    }
  });

  it('reports failed when latest run failed', () => {
    const env = setup();
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      env.db.prepare(
        `INSERT INTO lumos_app_runs
          (id, app_id, triggered_by, status, started_at, ended_at, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('run-1', 'native-demo', 'manual', 'failed', 1000, 1100, 'boom');
      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('failed');
      expect(status?.latestRun?.failureReason).toBe('boom');
    } finally {
      env.cleanup();
    }
  });

  it('reports acceptance progress and issue counts', () => {
    const env = setup({
      acceptance: [
        { id: 'open-app', label: '打开应用', howToVerify: '打开应用。' },
        { id: 'save-settings', label: '保存设置', howToVerify: '保存设置。' },
        { id: 'review-runs', label: '查看运行', howToVerify: '查看运行结果。' },
      ],
    });
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      env.store.create('acceptance_checks', {
        id: 'open-app',
        acceptance_id: 'open-app',
        status: 'passed',
        done: true,
      });
      env.store.create('acceptance_checks', {
        id: 'save-settings',
        acceptance_id: 'save-settings',
        status: 'failed',
        done: false,
      });

      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.counts).toMatchObject({
        acceptanceTotal: 3,
        acceptancePassed: 1,
        acceptanceIssues: 1,
      });
    } finally {
      env.cleanup();
    }
  });

  it('reports not_connected for declared automation without schedule permission', () => {
    const env = setup({ automations: { enabled: true } });
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('not_connected');
      expect(status?.missingCapabilities.join('\n')).toContain('system.schedule');
    } finally {
      env.cleanup();
    }
  });

  it('treats declared automation as connected when schedule permission is present', () => {
    const env = setup(
      { automations: { enabled: true } },
      { permissions: { data: 'isolated', system: ['schedule'] } },
    );
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('ready');
      expect(status?.missingCapabilities).toEqual([]);
    } finally {
      env.cleanup();
    }
  });

  it('reports missing permission for declared IM notifications', () => {
    const env = setup({ im: { enabled: true, lowRiskCommands: [] } });
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('not_connected');
      expect(status?.missingCapabilities.join('\n')).toContain('IM 通知权限');
    } finally {
      env.cleanup();
    }
  });

  it('treats IM notification bridge as ready after permission and target binding', () => {
    const env = setup({ im: { enabled: true, lowRiskCommands: [] } });
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      grantImBridge(env);

      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('ready');
      expect(status?.missingCapabilities).toEqual([]);
    } finally {
      env.cleanup();
    }
  });

  it('requires every declared low-risk IM command template to be tested before reporting ready', () => {
    const env = setup({ im: { enabled: true, lowRiskCommands: ['/status', '/runs'] } });
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      grantImBridge(env);

      expect(getNativeAppStatus(env.db, 'native-demo')?.missingCapabilities.join('\n'))
        .toContain('IM 命令模板尚未添加：/status、/runs');

      env.store.create('app_command_runs', {
        command: '/status',
        status: 'success',
        result_summary: 'ok',
      });
      env.store.create('app_command_runs', {
        command: '/runs',
        status: 'draft',
        result_summary: 'waiting',
      });
      const notReady = getNativeAppStatus(env.db, 'native-demo');
      expect(notReady?.status).toBe('not_connected');
      expect(notReady?.missingCapabilities.join('\n'))
        .toContain('IM 命令尚未测试成功：/runs');

      const runsRow = env.store.query('app_command_runs')
        .find((row) => row.command === '/runs');
      expect(runsRow).toBeTruthy();
      env.store.update('app_command_runs', runsRow?.id ?? '', {
        status: 'success',
        result_summary: 'ok',
      });
      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('ready');
      expect(status?.missingCapabilities).toEqual([]);
    } finally {
      env.cleanup();
    }
  });

  it('matches parameterized IM command families against concrete command rows', () => {
    const env = setup({
      im: {
        enabled: true,
        lowRiskCommands: [
          '/goofish status',
          '/goofish draft <conversation>',
          '/goofish confirm <draft>',
        ],
      },
    });
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      grantImBridge(env);

      env.store.create('app_command_runs', {
        command: '/goofish status',
        status: 'success',
        result_summary: 'ok',
      });
      env.store.create('app_command_runs', {
        command: '/goofish drafts',
        status: 'success',
        result_summary: 'draft list only',
      });
      expect(getNativeAppStatus(env.db, 'native-demo')?.missingCapabilities.join('\n'))
        .toContain('IM 命令模板尚未添加：/goofish draft <conversation>、/goofish confirm <draft>');

      env.store.create('app_command_runs', {
        command: '/goofish draft 张三',
        status: 'failed',
        result_summary: 'no conversation',
      });
      env.store.create('app_command_runs', {
        command: '/goofish confirm draftabc',
        status: 'success',
        result_summary: 'sent',
      });
      expect(getNativeAppStatus(env.db, 'native-demo')?.missingCapabilities.join('\n'))
        .toContain('IM 命令尚未测试成功：/goofish draft <conversation>');

      env.store.create('app_command_runs', {
        command: '/goofish draft 李四',
        status: 'success',
        result_summary: 'draft saved',
      });
      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('ready');
      expect(status?.missingCapabilities).toEqual([]);
    } finally {
      env.cleanup();
    }
  });

  it('keeps a Goofish native app not_connected until account state is synced', () => {
    const env = setup(
      { im: { enabled: false }, automations: { enabled: false } },
      { id: 'goofish-assistant', name: '闲鱼助手' },
    );
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('not_connected');
      expect(status?.missingCapabilities.join('\n')).toContain('闲鱼账号状态尚未同步');
    } finally {
      env.cleanup();
    }
  });

  it('keeps a Goofish native app not_connected until a ready account syncs successfully', () => {
    const env = setup(
      { im: { enabled: false }, automations: { enabled: false } },
      { id: 'goofish-assistant', name: '闲鱼助手' },
    );
    try {
      env.store.create('app_settings', { default_view: '工作台' });
      const account = env.store.create('goofish_accounts', {
        account_label: '闲鱼账号',
        login_status: 'ready',
        sync_status: 'failed',
      });
      expect(getNativeAppStatus(env.db, 'native-demo')?.missingCapabilities.join('\n'))
        .toContain('最近一次同步尚未成功');

      env.store.update('goofish_accounts', account.id, { sync_status: 'success' });
      const status = getNativeAppStatus(env.db, 'native-demo');
      expect(status?.status).toBe('ready');
      expect(status?.missingCapabilities).toEqual([]);
    } finally {
      env.cleanup();
    }
  });
});
