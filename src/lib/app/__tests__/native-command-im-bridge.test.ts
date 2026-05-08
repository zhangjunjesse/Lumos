import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';

import { runInstalledNativeAppImCommand } from '../native-command-im-bridge';
import { createAppDataStore } from '../runtime/data-store';

const goofishManifest = {
  id: 'goofish-assistant',
  name: '闲鱼助手',
  version: '1.0.0',
  icon: './icon.png',
  entry: 'inbox',
  tags: ['闲鱼'],
};

const genericManifest = {
  id: 'customer-notes',
  name: '客户记录',
  version: '1.0.0',
  icon: './icon.png',
  entry: 'items',
};

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  return {
    db,
    close: () => db.close(),
  };
}

function installGoofishApp(db: Database.Database) {
  db.prepare(
    `INSERT INTO lumos_app_apps
      (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'goofish-assistant',
    '闲鱼助手',
    '1.0.0',
    JSON.stringify(goofishManifest),
    'ai-generated',
    '/tmp/goofish-assistant',
    1714470000000,
  );
  return createAppDataStore(db, 'goofish-assistant');
}

function installGenericApp(db: Database.Database) {
  db.prepare(
    `INSERT INTO lumos_app_apps
      (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'customer-notes',
    '客户记录',
    '1.0.0',
    JSON.stringify(genericManifest),
    'ai-generated',
    '/tmp/customer-notes',
    1714470000000,
  );
  return createAppDataStore(db, 'customer-notes');
}

describe('native app IM command bridge', () => {
  it('runs a generic /app status command against a named installed app', async () => {
    const env = setup();
    try {
      const store = installGenericApp(env.db);
      store.create('app_settings', {
        id: 'general',
        ai_system_prompt: '帮我整理客户记录',
        risk_note: '只读外部系统',
      });
      store.create('acceptance_checks', {
        id: 'open-items',
        acceptance_id: 'open-items',
        done: true,
        status: 'passed',
        evidence: '已打开工作台',
      });

      const result = await runInstalledNativeAppImCommand({
        commandText: '/app 客户记录 status',
        deps: { db: env.db, now: () => 1714470000000 },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.appId).toBe('customer-notes');
      expect(result.message).toContain('「客户记录」');
      expect(result.message).toContain('客户记录 状态');
      expect(result.message).toContain('验收 1/1');
      expect(store.query('app_command_runs')).toEqual([
        expect.objectContaining({
          command: '/status',
          risk_level: 'read',
          confirmation_required: false,
          status: 'success',
          result_summary: expect.stringContaining('客户记录 状态'),
        }),
      ]);
      expect(store.query('app_command_runs')[0].result_summary).not.toContain('/goofish');
      expect(store.query('run_history')).toEqual([
        expect.objectContaining({
          title: '执行 IM 命令：/status',
          status: 'success',
        }),
      ]);
    } finally {
      env.close();
    }
  });

  it('uses the only installed app when /app omits the selector', async () => {
    const env = setup();
    try {
      const store = installGenericApp(env.db);
      store.create('run_history', {
        id: 'run-before',
        title: '安装自检',
        status: 'success',
        summary: '安装自检通过。',
      });

      const result = await runInstalledNativeAppImCommand({
        commandText: '/app runs',
        deps: { db: env.db, now: () => 1714470000000 },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.appId).toBe('customer-notes');
      expect(result.message).toContain('安装自检');
      expect(store.query('app_command_runs')).toEqual([
        expect.objectContaining({
          command: '/runs',
          status: 'success',
        }),
      ]);
    } finally {
      env.close();
    }
  });

  it('asks for an app selector when multiple apps are installed', async () => {
    const env = setup();
    try {
      installGenericApp(env.db);
      installGoofishApp(env.db);

      const result = await runInstalledNativeAppImCommand({
        commandText: '/app status',
        deps: { db: env.db, now: () => 1714470000000 },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('已安装多个应用');
      expect(result.message).toContain('客户记录');
      expect(result.message).toContain('闲鱼助手');
    } finally {
      env.close();
    }
  });

  it('keeps unsupported generic /app commands from falling through to the main Agent', async () => {
    const env = setup();
    try {
      installGenericApp(env.db);

      const result = await runInstalledNativeAppImCommand({
        commandText: '/app 客户记录 delete',
        deps: { db: env.db },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('只支持通用只读应用命令');
    } finally {
      env.close();
    }
  });

  it('runs /goofish status against the installed app and creates visible evidence', async () => {
    const env = setup();
    try {
      const store = installGoofishApp(env.db);
      store.create('goofish_accounts', {
        id: 'account-1',
        account_label: '卖家号',
        login_status: 'ready',
        sync_status: 'success',
      });

      const result = await runInstalledNativeAppImCommand({
        commandText: '/goofish status',
        deps: { db: env.db, now: () => 1714470000000 },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.appId).toBe('goofish-assistant');
      expect(result.message).toContain('「闲鱼助手」');
      expect(result.message).toContain('闲鱼账号 1 个');
      expect(store.query('app_command_runs')).toEqual([
        expect.objectContaining({
          command: '/goofish status',
          risk_level: 'read',
          status: 'success',
          result_summary: expect.stringContaining('登录可用 1 个'),
        }),
      ]);
      expect(store.query('run_history')).toEqual([
        expect.objectContaining({
          title: '执行 IM 命令：/goofish status',
          status: 'success',
        }),
      ]);
    } finally {
      env.close();
    }
  });

  it('does not silently sync from external WeChat commands', async () => {
    const env = setup();
    const runSyncAllAccounts = jest.fn();
    try {
      const store = installGoofishApp(env.db);

      const result = await runInstalledNativeAppImCommand({
        commandText: '/goofish sync',
        deps: {
          db: env.db,
          now: () => 1714470000000,
          goofish: { runSyncAllAccounts },
        },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('不会在微信里静默触发同步');
      expect(runSyncAllAccounts).not.toHaveBeenCalled();
      expect(store.query('app_command_runs')).toEqual([
        expect.objectContaining({
          command: '/goofish sync',
          risk_level: 'low_write',
          confirmation_required: true,
          status: 'pending_confirmation',
        }),
      ]);
      expect(store.query('run_history')).toEqual([
        expect.objectContaining({
          title: '执行 IM 命令：/goofish sync',
          status: 'failed',
          failure_reason: expect.stringContaining('明确确认'),
        }),
      ]);
    } finally {
      env.close();
    }
  });

  it('generates a local draft from /goofish draft without sending messages', async () => {
    const env = setup();
    try {
      const store = installGoofishApp(env.db);
      store.create('buyer_conversations', {
        id: 'conversation-1',
        conversation_id: 'cid-1',
        buyer_name: '张三',
        item_title: '二手相机',
        unread_count: 1,
        last_message: '能便宜点吗？',
        reply_status: '待回复',
      });
      const generateDraftText = jest.fn().mockResolvedValue({
        text: '您好，相机还在的，价格我再确认一下可优惠空间。',
      });

      const result = await runInstalledNativeAppImCommand({
        commandText: '/goofish draft 张三',
        deps: {
          db: env.db,
          now: () => 1714470000000,
          replyDraft: { generateDraftText },
        },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.message).toContain('回复草稿');
      expect(result.message).toContain('应用内确认');
      expect(generateDraftText).toHaveBeenCalled();
      expect(store.query('reply_drafts')).toEqual([
        expect.objectContaining({
          buyer_name: '张三',
          draft_text: expect.stringContaining('相机还在'),
          status: 'draft',
        }),
      ]);
      expect(store.query('app_command_runs')).toEqual([
        expect.objectContaining({
          command: '/goofish draft 张三',
          risk_level: 'low_write',
          confirmation_required: false,
          status: 'success',
        }),
      ]);
    } finally {
      env.close();
    }
  });

  it('confirms a pending draft from external WeChat only when a draft code is provided', async () => {
    const env = setup();
    try {
      const store = installGoofishApp(env.db);
      store.create('buyer_conversations', {
        id: 'conversation-1',
        conversation_id: 'cid-1',
        buyer_name: '张三',
        buyer_user_id: 'buyer-1',
        item_title: '二手相机',
        last_message: '能便宜点吗？',
        reply_status: '已草稿',
      });
      store.create('reply_drafts', {
        id: 'draft-abc123',
        conversation_id: 'cid-1',
        buyer_name: '张三',
        item_title: '二手相机',
        incoming_message: '能便宜点吗？',
        draft_text: '您好，相机还在的，价格我再确认一下。',
        status: 'draft',
        confirmation_channel: '未确认',
      });
      const sendMessage = jest.fn().mockResolvedValue(undefined);

      const listResult = await runInstalledNativeAppImCommand({
        commandText: '/goofish drafts',
        deps: { db: env.db, now: () => 1714470000000 },
      });
      expect(listResult.ok).toBe(true);
      expect(listResult.message).toContain('draftabc');

      const result = await runInstalledNativeAppImCommand({
        commandText: '/goofish confirm draftabc',
        deps: {
          db: env.db,
          now: () => 1714470000000,
          goofish: { sendMessage },
        },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.message).toContain('显式确认');
      expect(sendMessage).toHaveBeenCalledWith('cid-1', 'buyer-1', '您好，相机还在的，价格我再确认一下。');
      expect(store.get('reply_drafts', 'draft-abc123')).toEqual(expect.objectContaining({
        status: 'sent',
        confirmation_channel: '微信 IM 确认',
      }));
      expect(store.query('app_command_runs')).toEqual(expect.arrayContaining([
        expect.objectContaining({
          command: '/goofish drafts',
          risk_level: 'read',
          status: 'success',
        }),
        expect.objectContaining({
          command: '/goofish confirm draftabc',
          risk_level: 'low_write',
          confirmation_required: true,
          status: 'success',
        }),
      ]));
    } finally {
      env.close();
    }
  });

  it('rejects a pending draft from external WeChat without sending messages', async () => {
    const env = setup();
    try {
      const store = installGoofishApp(env.db);
      store.create('buyer_conversations', {
        id: 'conversation-1',
        conversation_id: 'cid-1',
        buyer_name: '张三',
        item_title: '二手相机',
        last_message: '能便宜点吗？',
        reply_status: '已草稿',
      });
      store.create('reply_drafts', {
        id: 'draft-reject1',
        conversation_id: 'cid-1',
        buyer_name: '张三',
        item_title: '二手相机',
        draft_text: '您好，相机还在的。',
        status: 'draft',
        confirmation_channel: '未确认',
        confirmation_code: 'reject1',
      });

      const result = await runInstalledNativeAppImCommand({
        commandText: '/goofish reject reject1',
        deps: {
          db: env.db,
          now: () => 1714470000000,
        },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.message).toContain('已拒绝');
      expect(store.get('reply_drafts', 'draft-reject1')).toEqual(expect.objectContaining({
        status: 'rejected',
      }));
      expect(store.query('app_command_runs')).toEqual([
        expect.objectContaining({
          command: '/goofish reject reject1',
          risk_level: 'low_write',
          confirmation_required: true,
          status: 'success',
        }),
      ]);
    } finally {
      env.close();
    }
  });

  it('handles unsupported Goofish commands without falling through to the main Agent', async () => {
    const env = setup();
    try {
      installGoofishApp(env.db);

      const result = await runInstalledNativeAppImCommand({
        commandText: '/goofish change-price',
        deps: { db: env.db },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('只支持低风险闲鱼应用命令');
      expect(result.message).toContain('改价');
    } finally {
      env.close();
    }
  });

  it('returns clear setup guidance when no Goofish app is installed', async () => {
    const env = setup();
    try {
      const result = await runInstalledNativeAppImCommand({
        commandText: '/goofish unread',
        deps: { db: env.db },
      });

      expect(result.handled).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('还没有找到已启用的闲鱼助手应用');
    } finally {
      env.close();
    }
  });
});
