import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';

import { EXTRACT_SIGNALS_SCRIPT, OUTER_HTML_SCRIPT } from '../amazon-page';
import type { RankBrowserSession } from '../browser-session';
import { executeRankRun, type ExecuteRankRunDeps } from '../runner';
import { createRun, getRun, getRunResults } from '../store';

function makeStore(): AppDataStore {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  return createAppDataStore(db, 'amazon-rank');
}

interface FakePage {
  /** 每个关键词导航后，提取脚本返回的信号（按导航顺序出队） */
  signalsQueue: string[];
}

function makeSession(page: FakePage): RankBrowserSession & { closed: boolean; navigations: string[] } {
  let currentSignals = '';
  const session = {
    closed: false,
    navigations: [] as string[],
    pageId: 'p1',
    api: {
      connected: true,
      navigate: async (url: string) => {
        session.navigations.push(url);
        currentSignals = page.signalsQueue.shift() ?? '';
      },
      click: async () => {},
      fill: async () => {},
      type: async () => {},
      press: async () => {},
      waitFor: async () => {},
      evaluate: async <T,>(script: string): Promise<T> => {
        if (script === OUTER_HTML_SCRIPT) return '<html>page</html>' as T;
        if (script === EXTRACT_SIGNALS_SCRIPT) return currentSignals as T;
        return undefined as T;
      },
      snapshot: async () => ({ title: 'Amazon', content: 'Deliver to New York 10001', url: '' }),
      screenshot: async () => '',
      pages: async () => [],
      currentPage: async () => ({ id: 'p1', url: '', title: '' }),
      newPage: async () => ({ id: 'p1' }),
      selectPage: async () => {},
      closePage: async () => {},
      release: async () => {},
    },
    async close() {
      session.closed = true;
    },
  };
  return session as RankBrowserSession & { closed: boolean; navigations: string[] };
}

function deps(session: RankBrowserSession, overrides: Partial<ExecuteRankRunDeps> = {}): ExecuteRankRunDeps {
  return {
    openSession: async () => session,
    sleep: async () => {},
    random: () => 0,
    saveSnapshot: () => undefined,
    ...overrides,
  };
}

function signals(input: { organic?: string[]; nodes?: number; captcha?: boolean; noResults?: boolean }): string {
  return JSON.stringify({
    organicAsins: input.organic ?? [],
    resultNodeCount: input.nodes ?? (input.organic?.length ?? 0),
    captcha: input.captcha ?? false,
    noResults: input.noResults ?? false,
  });
}

function seedRun(store: AppDataStore, keywords: string[], asins: string[]): string {
  return createRun(store, {
    source: 'manual',
    site: 'www.amazon.com',
    zipCode: '10001',
    keywords,
    asins,
    outputDir: '',
  }).id;
}

describe('executeRankRun', () => {
  it('逐词查询、匹配 ASIN 排名、运行成功并写 run_history', async () => {
    const store = makeStore();
    const runId = seedRun(store, ['yoga mat', 'bottle'], ['B0AAAAAAA1', 'B0BBBBBBB2']);
    const session = makeSession({
      signalsQueue: [
        signals({ organic: ['B0XXXXXXX0', 'B0AAAAAAA1', 'B0YYYYYYY0'] }),
        signals({ organic: ['B0BBBBBBB2'] }),
      ],
    });

    await executeRankRun(store, runId, new AbortController().signal, deps(session));

    const run = getRun(store, runId)!;
    expect(run.status).toBe('success');
    expect(run.keywords_done).toBe(2);
    expect(run.matches_total).toBe(2);
    expect(run.zip_confirmed).toBe(true);

    const results = getRunResults(store, runId);
    expect(results[0].status).toBe('ok');
    expect(results[0].matches).toEqual([{ asin: 'B0AAAAAAA1', rank: 2 }]);
    expect(results[1].matches).toEqual([{ asin: 'B0BBBBBBB2', rank: 1 }]);

    expect(session.closed).toBe(true);
    expect(session.navigations[0]).toContain('k=yoga%20mat');

    const history = store.query('run_history', { limit: 10 });
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('success');
  });

  it('遇到验证码立即中止：当前词 blocked、其余取消、运行失败', async () => {
    const store = makeStore();
    const runId = seedRun(store, ['kw1', 'kw2', 'kw3'], ['B0AAAAAAA1']);
    const session = makeSession({
      signalsQueue: [signals({ captcha: true }), signals({ organic: ['B0AAAAAAA1'] })],
    });

    await executeRankRun(store, runId, new AbortController().signal, deps(session));

    const run = getRun(store, runId)!;
    expect(run.status).toBe('failed');
    expect(run.failure_reason).toContain('验证码');

    const results = getRunResults(store, runId);
    expect(results.map((r) => r.status)).toEqual(['blocked', 'cancelled', 'cancelled']);
    expect(session.navigations).toHaveLength(1);
  });

  it('用户停止：剩余词取消、运行状态 cancelled', async () => {
    const store = makeStore();
    const runId = seedRun(store, ['kw1', 'kw2'], ['B0AAAAAAA1']);
    const controller = new AbortController();
    controller.abort();
    const session = makeSession({ signalsQueue: [] });

    await executeRankRun(store, runId, controller.signal, deps(session));

    const run = getRun(store, runId)!;
    expect(run.status).toBe('cancelled');
    expect(getRunResults(store, runId).every((r) => r.status === 'cancelled')).toBe(true);
  });

  it('浏览器未连接：运行直接失败并写明原因', async () => {
    const store = makeStore();
    const runId = seedRun(store, ['kw1'], ['B0AAAAAAA1']);

    await executeRankRun(store, runId, new AbortController().signal, {
      openSession: async () => ({ error: '浏览器未连接：请确认 Lumos 桌面端已启动' }),
      sleep: async () => {},
    });

    const run = getRun(store, runId)!;
    expect(run.status).toBe('failed');
    expect(run.failure_reason).toContain('浏览器未连接');
  });

  it('连续执行层失败达到阈值即中止', async () => {
    const store = makeStore();
    const runId = seedRun(store, ['kw1', 'kw2', 'kw3', 'kw4', 'kw5'], ['B0AAAAAAA1']);
    const session = makeSession({ signalsQueue: [] });
    session.api.navigate = async () => {
      throw new Error('net::ERR_DISCONNECTED');
    };

    await executeRankRun(store, runId, new AbortController().signal, deps(session));

    const run = getRun(store, runId)!;
    expect(run.status).toBe('failed');
    expect(run.failure_reason).toContain('连续 3 个关键词执行失败');
    const statuses = getRunResults(store, runId).map((r) => r.status);
    expect(statuses).toEqual(['failed', 'failed', 'failed', 'cancelled', 'cancelled']);
  });

  it('部分成功：有词无结果时运行为 partial 且如实记录', async () => {
    const store = makeStore();
    const runId = seedRun(store, ['kw1', 'kw2'], ['B0AAAAAAA1']);
    const session = makeSession({
      signalsQueue: [
        signals({ organic: ['B0AAAAAAA1'] }),
        signals({ noResults: true }),
      ],
    });

    await executeRankRun(store, runId, new AbortController().signal, deps(session));

    const run = getRun(store, runId)!;
    expect(run.status).toBe('partial');
    const results = getRunResults(store, runId);
    expect(results[1].status).toBe('no_results');
    expect(results[1].error_message).toContain('没有匹配的商品');
  });
});
