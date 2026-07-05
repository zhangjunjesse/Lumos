import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';

import { setRankSettings } from '../settings';
import { openSnapshotInSettingsBrowser } from '../snapshot-open';
import { createRun, getRunResults, updateResult } from '../store';

function makeStore(): AppDataStore {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  return createAppDataStore(db, 'amazon-rank');
}

function seedRunWithSnapshot(store: AppDataStore): { runId: string; resultId: string } {
  createRun(store, {
    id: 'run-1',
    source: 'manual',
    site: 'www.amazon.com',
    zipCode: '10001',
    keywords: ['gas torch'],
    asins: ['B0ABCD1234'],
    outputDir: '/tmp/out',
  });
  const resultId = getRunResults(store, 'run-1')[0].id;
  updateResult(store, resultId, { snapshot_path: '/tmp/out/snapshots/001_gas_torch.html' });
  return { runId: 'run-1', resultId };
}

interface BridgeCall {
  pathname: string;
  body: Record<string, unknown>;
  browserContextId?: string;
}

function makeDeps(input: { failOpen?: string } = {}) {
  const calls: BridgeCall[] = [];
  const resolved: Array<string | undefined> = [];
  const deps = {
    fileExists: () => true,
    resolveConfig: (options: { browserContextId?: string | null } = {}) => {
      resolved.push(options.browserContextId ?? undefined);
      return {
        baseUrl: 'http://127.0.0.1:9999',
        token: 't',
        source: 'env' as const,
        browserContextId: options.browserContextId ?? undefined,
      };
    },
    post: async (
      config: { browserContextId?: string },
      pathname: string,
      body: Record<string, unknown>,
    ) => {
      calls.push({ pathname, body, browserContextId: config.browserContextId });
      if (pathname === '/v1/pages/new' && input.failOpen) {
        throw new Error(input.failOpen);
      }
      return { ok: true };
    },
  };
  return { deps, calls, resolved };
}

describe('openSnapshotInSettingsBrowser', () => {
  it('默认设置走内置浏览器，前台开快照页并释放租约', async () => {
    const store = makeStore();
    const { runId, resultId } = seedRunWithSnapshot(store);
    const { deps, calls, resolved } = makeDeps();

    const outcome = await openSnapshotInSettingsBrowser(
      store,
      { runId, resultId, origin: 'http://127.0.0.1:3000' },
      deps,
    );

    expect(outcome).toEqual({ ok: true, browserContextId: 'embedded:default' });
    expect(resolved).toEqual(['embedded:default']);
    expect(calls.map((c) => c.pathname)).toEqual(['/v1/pages/new', '/v1/context/release']);
    expect(calls[0].body.url).toBe(
      `http://127.0.0.1:3000/api/apps/builtin/amazon-rank/runs/${runId}/snapshot?resultId=${resultId}`,
    );
    expect(calls[0].body.background).toBeUndefined();
  });

  it('设置选了 AdsPower 就在 AdsPower 上下文开页', async () => {
    const store = makeStore();
    const { runId, resultId } = seedRunWithSnapshot(store);
    setRankSettings(store, { browserContextId: 'adspower:k1ck97si' });
    const { deps, resolved } = makeDeps();

    const outcome = await openSnapshotInSettingsBrowser(
      store,
      { runId, resultId, origin: 'http://127.0.0.1:3000' },
      deps,
    );

    expect(outcome).toEqual({ ok: true, browserContextId: 'adspower:k1ck97si' });
    expect(resolved).toEqual(['adspower:k1ck97si']);
  });

  it('没有快照时如实报错，不去开浏览器', async () => {
    const store = makeStore();
    createRun(store, {
      id: 'run-2',
      source: 'manual',
      site: 'www.amazon.com',
      zipCode: '10001',
      keywords: ['gas torch'],
      asins: ['B0ABCD1234'],
      outputDir: '/tmp/out',
    });
    const resultId = getRunResults(store, 'run-2')[0].id;
    const { deps, calls } = makeDeps();

    const outcome = await openSnapshotInSettingsBrowser(
      store,
      { runId: 'run-2', resultId, origin: 'http://127.0.0.1:3000' },
      deps,
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('快照');
    expect(calls).toHaveLength(0);
  });

  it('bridge 未就绪时给出可读错误', async () => {
    const store = makeStore();
    const { runId, resultId } = seedRunWithSnapshot(store);

    const outcome = await openSnapshotInSettingsBrowser(
      store,
      { runId, resultId, origin: 'http://127.0.0.1:3000' },
      { fileExists: () => true, resolveConfig: () => null, post: async () => ({ ok: true }) },
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('浏览器未连接');
  });

  it('所选浏览器不可用时映射成人话，并且仍尝试释放租约', async () => {
    const store = makeStore();
    const { runId, resultId } = seedRunWithSnapshot(store);
    const { deps, calls } = makeDeps({ failOpen: 'BROWSER_CONTEXT_UNAVAILABLE' });

    const outcome = await openSnapshotInSettingsBrowser(
      store,
      { runId, resultId, origin: 'http://127.0.0.1:3000' },
      deps,
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain('所选浏览器未连接');
    expect(calls.map((c) => c.pathname)).toEqual(['/v1/pages/new', '/v1/context/release']);
  });
});
