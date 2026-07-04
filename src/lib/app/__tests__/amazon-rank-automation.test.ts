import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';

import type { AppManifest } from '../manifest/types';
import {
  runNativeAppAutomation,
  SUPPORTED_NATIVE_AUTOMATION_ACTIONS,
} from '../native-automation-runner';
import { ensureAmazonRankDefaultAutomations } from '../amazon-rank-default-automations';
import { createAppDataStore } from '../runtime/data-store';

jest.mock('@/lib/amazon-rank/monitor', () => ({
  runMonitorAutomation: jest.fn(async () => ({
    ok: true,
    message: '监控 2 个关键词：2 个查到排名页，命中 1 个排名；状态：成功',
    reasons: [],
    runId: 'run-x',
  })),
}));

function makeEnv() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  const store = createAppDataStore(db, 'amazon-rank');
  ensureAmazonRankDefaultAutomations(store);
  const automation = store.query<{ native_action?: string }>('app_automations', { limit: 10 })[0];
  store.update('app_automations', automation.id, { enabled: true });
  return { db, store, automationId: automation.id };
}

const manifest = { id: 'amazon-rank', name: '亚马逊排名助手', version: '0.1.0' } as AppManifest;

describe('amazon-rank:run-monitor 自动化桥', () => {
  it('动作已注册进支持集', () => {
    expect(SUPPORTED_NATIVE_AUTOMATION_ACTIONS.has('amazon-rank:run-monitor')).toBe(true);
  });

  it('非本应用的 manifest 拒绝执行', async () => {
    const { db, store, automationId } = makeEnv();
    const result = await runNativeAppAutomation({
      manifest: { ...manifest, id: 'other-app' } as AppManifest,
      store,
      rowId: automationId,
      confirmed: true,
      db,
      appId: 'other-app',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('不是亚马逊排名助手');
  });

  it('成功运行：写 run_history 并更新自动化行', async () => {
    const { db, store, automationId } = makeEnv();
    const result = await runNativeAppAutomation({
      manifest,
      store,
      rowId: automationId,
      confirmed: true,
      db,
      appId: 'amazon-rank',
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('命中 1 个排名');

    const history = store.query<{ status?: string; title?: string }>('run_history', { limit: 10 });
    expect(history.some((h) => h.status === 'success' && (h.title ?? '').includes('每日排名监控'))).toBe(true);

    const automation = store.get<{ last_status?: string; last_run_summary?: string }>(
      'app_automations',
      automationId,
    );
    expect(automation?.last_status).toBe('success');
    expect(automation?.last_run_summary).toContain('命中 1 个排名');
  });

  it('默认 seed：每日监控默认停用、native_action 防重', () => {
    const { store } = makeEnv();
    ensureAmazonRankDefaultAutomations(store); // 再跑一次不产生重复行
    const rows = store.query<{ native_action?: string }>('app_automations', { limit: 10 });
    expect(rows.filter((r) => r.native_action === 'amazon-rank:run-monitor')).toHaveLength(1);
  });
});
