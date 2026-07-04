import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';

import { runMonitorAutomation } from '../monitor';
import { setWatchlist } from '../settings';
import { createRun, finishRun, getRun, getRunResults, markResultDone, updateRun } from '../store';

function makeEnv(): { db: Database.Database; store: AppDataStore } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  return { db, store: createAppDataStore(db, 'amazon-rank') };
}

describe('runMonitorAutomation', () => {
  it('监控清单为空：如实失败并指引用户去设置', async () => {
    const { db, store } = makeEnv();
    const report = await runMonitorAutomation({ store, db, appId: 'amazon-rank' });
    expect(report.ok).toBe(false);
    expect(report.message).toContain('设为每日监控');
  });

  it('跑完监控运行：汇总摘要并推送 IM 通知', async () => {
    const { db, store } = makeEnv();
    setWatchlist(store, { keywords: ['yoga mat'], asins: ['B0AAAAAAA1'] });

    const notifyCalls: Array<{ title: string; text: string; severity: string }> = [];
    const report = await runMonitorAutomation(
      { store, db, appId: 'amazon-rank' },
      {
        start: ({ store: s, keywords, asins }) => {
          const run = createRun(s, {
            source: 'monitor',
            site: 'www.amazon.com',
            zipCode: '10001',
            keywords,
            asins,
            outputDir: '',
          });
          const [result] = getRunResults(s, run.id);
          markResultDone(s, result.id, {
            status: 'ok',
            topAsins: ['B0AAAAAAA1'],
            matches: [{ asin: 'B0AAAAAAA1', rank: 1 }],
            organicCount: 1,
          });
          updateRun(s, run.id, { keywords_done: 1, matches_total: 1 });
          finishRun(s, run.id, 'success');
          return { run, finished: Promise.resolve(getRun(s, run.id)) };
        },
        notify: async (input) => {
          notifyCalls.push({ title: input.title, text: input.text, severity: input.severity });
          return { ok: true };
        },
      },
    );

    expect(report.ok).toBe(true);
    expect(report.message).toContain('监控 1 个关键词');
    expect(report.message).toContain('命中 1 个排名');
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].severity).toBe('success');
  });

  it('IM 通知失败：结果仍以运行为准，原因如实附上', async () => {
    const { db, store } = makeEnv();
    setWatchlist(store, { keywords: ['kw'], asins: ['B0AAAAAAA1'] });

    const report = await runMonitorAutomation(
      { store, db, appId: 'amazon-rank' },
      {
        start: ({ store: s, keywords, asins }) => {
          const run = createRun(s, {
            source: 'monitor', site: 'www.amazon.com', zipCode: '10001', keywords, asins, outputDir: '',
          });
          finishRun(s, run.id, 'success');
          return { run, finished: Promise.resolve(getRun(s, run.id)) };
        },
        notify: async () => ({ ok: false, error: '还没有绑定可发送的微信 IM 会话' }),
      },
    );

    expect(report.ok).toBe(true);
    expect(report.reasons.join('')).toContain('IM 通知未发出');
  });
});
