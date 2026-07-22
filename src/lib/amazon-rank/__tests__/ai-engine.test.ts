import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';

import { EXTRACT_SIGNALS_SCRIPT, OUTER_HTML_SCRIPT } from '../amazon-page';
import type { StructuredGenerate } from '../ai-operator';
import type { RankBrowserSession } from '../browser-session';
import { BUILTIN_RULES, buildExtractSignalsScript, getDraftRules } from '../extraction-rules';
import { PAGE_DIGEST_SCRIPT } from '../page-digest';
import { executeRankRun, type ExecuteRankRunDeps } from '../runner';
import { setRankSettings } from '../settings';
import { createRun, getRun, getRunResults } from '../store';

function makeStore(): AppDataStore {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  return createAppDataStore(db, 'amazon-rank');
}

function seedAiRun(store: AppDataStore, keywords: string[], asins: string[]): string {
  setRankSettings(store, { executionMode: 'ai' });
  return createRun(store, {
    source: 'manual',
    engine: 'ai',
    site: 'www.amazon.com',
    zipCode: '10001',
    keywords,
    asins,
    outputDir: '',
  }).id;
}

const DIGEST = JSON.stringify({
  title: 'Amazon.com : yoga mat',
  url: 'https://www.amazon.com/s?k=yoga+mat',
  bodyTextHead: 'results',
  cards: [{ i: 0, tag: 'div', type: 's-search-result', asin: 'B0AAAAAAA1', cls: '', text: 'Yoga Mat' }],
});

const signals = (organic: string[]) =>
  JSON.stringify({ organicAsins: organic, resultNodeCount: organic.length || 0, captcha: false, noResults: false });

/**
 * 可编排的假会话：按脚本类型路由 evaluate。
 * activeResult / candidateResult 用「当前关键词的序号」查表，模拟真实页上跑规则脚本。
 */
function makeAiSession(plan: {
  candidateScript?: string;
  activeResults: string[][];
  candidateResults?: string[][];
}): RankBrowserSession & { navigations: string[] } {
  let nav = -1;
  const session = {
    navigations: [] as string[],
    pageId: 'p1',
    api: {
      connected: true,
      navigate: async (url: string) => {
        session.navigations.push(url);
        nav++;
      },
      click: async () => {},
      fill: async () => {},
      type: async () => {},
      press: async () => {},
      waitFor: async () => {},
      evaluate: async <T,>(script: string): Promise<T> => {
        if (script === OUTER_HTML_SCRIPT) return '<html>page</html>' as T;
        if (script === PAGE_DIGEST_SCRIPT) return DIGEST as T;
        if (script === EXTRACT_SIGNALS_SCRIPT) return signals(plan.activeResults[nav] ?? []) as T;
        if (plan.candidateScript && script === plan.candidateScript) {
          return signals(plan.candidateResults?.[nav] ?? []) as T;
        }
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
    async close() {},
  };
  return session as unknown as RankBrowserSession & { navigations: string[] };
}

function deps(session: RankBrowserSession, generate: StructuredGenerate): ExecuteRankRunDeps {
  return {
    openSession: async () => session,
    sleep: async () => {},
    random: () => 0,
    saveSnapshot: () => undefined,
    generate,
  };
}

const PROPOSED_RULES = { ...BUILTIN_RULES, resultSelector: '[data-test="result-v2"]' };

function makeGenerate(reads: Array<Record<string, unknown>>): {
  generate: StructuredGenerate;
  calls: { read: number; propose: number };
} {
  const calls = { read: 0, propose: 0 };
  const generate = (async ({ prompt }: { prompt: string }) => {
    if (prompt.includes('当前失效的规则')) {
      calls.propose++;
      return { ...PROPOSED_RULES, rationale: '结果卡片选择器改版' };
    }
    calls.read++;
    return reads.shift() ?? { organicAsins: [], captcha: false, noResults: false };
  }) as unknown as StructuredGenerate;
  return { generate, calls };
}

describe('AI 操作引擎', () => {
  it('AI 读页出结果；现役规则失效时提案并跨关键词验证，运行结束落草稿', async () => {
    const store = makeStore();
    const runId = seedAiRun(store, ['yoga mat', 'bottle'], ['B0AAAAAAA1', 'B0BBBBBBB2']);
    const kw1 = ['B0AAAAAAA1', 'B0CCCCCCC3'];
    const kw2 = ['B0BBBBBBB2'];
    const { generate, calls } = makeGenerate([
      { organicAsins: kw1, captcha: false, noResults: false },
      { organicAsins: kw2, captcha: false, noResults: false },
    ]);
    const session = makeAiSession({
      candidateScript: buildExtractSignalsScript(PROPOSED_RULES),
      activeResults: [[], []], // 现役规则在两页上都抓不到 → 触发修复轨道
      candidateResults: [kw1, kw2], // 候选规则在真实页面上与 AI 结果一致
    });

    await executeRankRun(store, runId, new AbortController().signal, deps(session, generate));

    const run = getRun(store, runId)!;
    expect(run.status).toBe('success');
    expect(run.matches_total).toBe(2);
    const results = getRunResults(store, runId);
    expect(results[0].status).toBe('ok');
    expect(results[0].top_asins).toEqual(kw1);
    expect(results[0].matches).toEqual([{ asin: 'B0AAAAAAA1', rank: 1 }]);

    expect(calls.read).toBe(2);
    expect(calls.propose).toBe(1); // 第二个词直接验证候选，不再提案

    const draft = getDraftRules(store);
    expect(draft).not.toBeNull();
    expect(draft!.rules.resultSelector).toBe('[data-test="result-v2"]');
    expect(draft!.validated_keywords).toEqual(['yoga mat', 'bottle']);
    expect(draft!.note).toContain('选择器改版');
    expect(run.repair_note).toContain('修复草稿');
    expect(run.repair_note).toContain('2 个关键词');
  });

  it('单关键词快测也能出草稿，并把修复说明写进运行记录', async () => {
    const store = makeStore();
    const kw1 = ['B0AAAAAAA1'];
    const runId = seedAiRun(store, ['yoga mat'], ['B0AAAAAAA1']);
    const { generate, calls } = makeGenerate([{ organicAsins: kw1, captcha: false, noResults: false }]);
    const session = makeAiSession({
      candidateScript: buildExtractSignalsScript(PROPOSED_RULES),
      activeResults: [[]],
      candidateResults: [kw1],
    });

    await executeRankRun(store, runId, new AbortController().signal, deps(session, generate));

    expect(calls.propose).toBe(1);
    const draft = getDraftRules(store);
    expect(draft).not.toBeNull();
    expect(draft!.validated_keywords).toEqual(['yoga mat']);
    expect(getRun(store, runId)!.repair_note).toContain('1 个关键词');
  });

  it('候选未通过页面验证：不落草稿，但把原因写进运行记录', async () => {
    const store = makeStore();
    const kw1 = ['B0AAAAAAA1'];
    const runId = seedAiRun(store, ['yoga mat'], ['B0AAAAAAA1']);
    const { generate } = makeGenerate([{ organicAsins: kw1, captcha: false, noResults: false }]);
    const session = makeAiSession({
      candidateScript: buildExtractSignalsScript(PROPOSED_RULES),
      activeResults: [[]],
      candidateResults: [['B0ZZZZZZZ9']], // 候选跑出来和 AI 结果不一致 → 验证失败
    });

    await executeRankRun(store, runId, new AbortController().signal, deps(session, generate));

    expect(getDraftRules(store)).toBeNull();
    const note = getRun(store, runId)!.repair_note as string;
    expect(note).toContain('未能通过页面验证');
  });

  it('现役规则健康时不提案、不落草稿', async () => {
    const store = makeStore();
    const kw1 = ['B0AAAAAAA1'];
    const runId = seedAiRun(store, ['yoga mat'], ['B0AAAAAAA1']);
    const { generate, calls } = makeGenerate([{ organicAsins: kw1, captcha: false, noResults: false }]);
    const session = makeAiSession({ activeResults: [kw1] });

    await executeRankRun(store, runId, new AbortController().signal, deps(session, generate));

    expect(getRun(store, runId)!.status).toBe('success');
    expect(calls.propose).toBe(0);
    expect(getDraftRules(store)).toBeNull();
  });

  it('AI 判定验证码 → blocked 并立即中止（AI 模式同样不闯风控）', async () => {
    const store = makeStore();
    const runId = seedAiRun(store, ['kw1', 'kw2'], ['B0AAAAAAA1']);
    const { generate } = makeGenerate([{ organicAsins: [], captcha: true, noResults: false }]);
    const session = makeAiSession({ activeResults: [[]] });

    await executeRankRun(store, runId, new AbortController().signal, deps(session, generate));

    const run = getRun(store, runId)!;
    expect(run.status).toBe('failed');
    expect(run.failure_reason).toContain('验证码');
    expect(getRunResults(store, runId).map((r) => r.status)).toEqual(['blocked', 'cancelled']);
    expect(session.navigations).toHaveLength(1);
  });

  it('大模型持续报错 → 连续失败阈值中止，错误如实透传', async () => {
    const store = makeStore();
    const runId = seedAiRun(store, ['kw1', 'kw2', 'kw3', 'kw4'], ['B0AAAAAAA1']);
    const generate = (async () => {
      throw new Error('Provider 未配置可用的 API Key');
    }) as unknown as StructuredGenerate;
    const session = makeAiSession({ activeResults: [] });

    await executeRankRun(store, runId, new AbortController().signal, deps(session, generate));

    const run = getRun(store, runId)!;
    expect(run.status).toBe('failed');
    expect(run.failure_reason).toContain('连续 3 个关键词执行失败');
    expect(run.failure_reason).toContain('API Key');
  });
});
