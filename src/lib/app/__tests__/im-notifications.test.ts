import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';

import { recordDefaultUserImTarget, getLatestAppImNotification } from '../im-bridge';
import { sendAppImNotification } from '../im-notifications';
import { createAppDataStore } from '../runtime/data-store';

function setup(perms: string[] = ['system:im-notification']) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  const now = 1000;
  db.prepare(
    `INSERT INTO lumos_app_apps
      (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'demo-app',
    'Demo App',
    '1.0.0',
    JSON.stringify({
      id: 'demo-app',
      name: 'Demo App',
      version: '1.0.0',
      icon: './icon.png',
      entry: 'im',
      permissions: { data: 'isolated', system: ['im-notification'] },
    }),
    'ai-generated',
    '/tmp/demo-app',
    now,
  );
  const insertPermission = db.prepare(
    `INSERT INTO lumos_app_permissions (app_id, permission, granted, granted_at)
     VALUES (?, ?, ?, ?)`,
  );
  for (const permission of perms) {
    insertPermission.run('demo-app', permission, 1, now);
  }
  return {
    db,
    store: createAppDataStore(db, 'demo-app'),
    close: () => db.close(),
  };
}

describe('sendAppImNotification', () => {
  it('sends to the default inbound IM target and records app context', async () => {
    const env = setup();
    try {
      recordDefaultUserImTarget({
        providerId: 'wechat',
        chatId: 'wx-user-1',
        label: '微信用户',
        source: 'wechat-inbound',
        updatedAt: 1234,
      }, env.db);
      const send = jest.fn(async () => ({ ok: true, messageId: 'mid-1' }));

      const result = await sendAppImNotification({
        db: env.db,
        appId: 'demo-app',
        title: '提醒',
        text: '有新消息',
      }, {
        send,
        now: () => 2000,
      });

      expect(result.ok).toBe(true);
      expect(result.providerId).toBe('wechat');
      expect(result.chatId).toBe('wx-user-1');
      expect(send).toHaveBeenCalledWith('wechat', expect.objectContaining({
        address: { providerId: 'wechat', chatId: 'wx-user-1' },
        text: '【Demo App】提醒\n有新消息',
      }));
      const context = getLatestAppImNotification('wechat', 'wx-user-1', env.db, { now: 2000 });
      expect(context?.appName).toBe('Demo App');
      expect(context?.title).toBe('提醒');
    } finally {
      env.close();
    }
  });

  it('denies apps without im-notification permission', async () => {
    const env = setup([]);
    try {
      const result = await sendAppImNotification({
        db: env.db,
        appId: 'demo-app',
        text: 'hi',
      }, {
        send: jest.fn(),
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('IM 通知权限');
    } finally {
      env.close();
    }
  });

  it('uses notification row target and updates send status', async () => {
    const env = setup();
    try {
      recordDefaultUserImTarget({
        providerId: 'wechat',
        chatId: 'wx-row',
        label: '行内目标',
        source: 'wechat-inbound',
        updatedAt: 1234,
      }, env.db);
      const row = env.store.create('app_notifications', {
        channel: 'wechat_im',
        provider_id: 'wechat',
        chat_id: 'wx-row',
        target_label: '行内目标',
        title: '行通知',
        text: '行正文',
        status: 'ready',
      });
      const send = jest.fn(async () => ({ ok: true, messageId: 'mid-row' }));

      const result = await sendAppImNotification({
        db: env.db,
        appId: 'demo-app',
        notificationId: row.id,
      }, {
        send,
        now: () => 3000,
      });

      expect(result.ok).toBe(true);
      expect(send).toHaveBeenCalledWith('wechat', expect.objectContaining({
        address: { providerId: 'wechat', chatId: 'wx-row' },
      }));
      const updated = env.store.get('app_notifications', row.id) as {
        status?: string;
        last_message_id?: string;
      } | null;
      expect(updated?.status).toBe('sent');
      expect(updated?.last_message_id).toBe('mid-row');
    } finally {
      env.close();
    }
  });

  it('rejects explicit targets outside the bound default user chat', async () => {
    const env = setup();
    try {
      recordDefaultUserImTarget({
        providerId: 'wechat',
        chatId: 'wx-user-1',
        label: '微信用户',
        source: 'wechat-inbound',
        updatedAt: 1234,
      }, env.db);
      const send = jest.fn();

      const result = await sendAppImNotification({
        db: env.db,
        appId: 'demo-app',
        title: '提醒',
        text: '不要发到其它群',
        target: {
          providerId: 'wechat',
          chatId: 'wx-other-chat',
          label: '其它会话',
        },
      }, {
        send,
        now: () => 3500,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('只能发送到用户自己的默认微信会话');
      expect(send).not.toHaveBeenCalled();
    } finally {
      env.close();
    }
  });

  it('records a product-facing failure when WeChat context token is missing', async () => {
    const env = setup();
    try {
      recordDefaultUserImTarget({
        providerId: 'wechat',
        chatId: 'wx-row',
        label: '微信用户',
        source: 'wechat-inbound',
        updatedAt: 1234,
      }, env.db);
      const row = env.store.create('app_notifications', {
        channel: 'wechat_im',
        provider_id: 'wechat',
        chat_id: 'wx-row',
        target_label: '微信用户',
        status: 'ready',
      });
      const result = await sendAppImNotification({
        db: env.db,
        appId: 'demo-app',
        notificationId: row.id,
        text: 'hi',
      }, {
        send: jest.fn(async () => ({
          ok: false,
          error: 'No context_token for this peer yet.',
        })),
        now: () => 4000,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('先在微信里给 Lumos/Clawbot 发一条消息');
      const updated = env.store.get('app_notifications', row.id) as {
        status?: string;
        last_error?: string;
      } | null;
      expect(updated?.status).toBe('failed');
      expect(updated?.last_error).toContain('会话令牌不可用');
    } finally {
      env.close();
    }
  });
});
