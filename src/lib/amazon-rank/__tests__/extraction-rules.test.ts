import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';
import { createAppDataStore, type AppDataStore } from '@/lib/app/runtime/data-store';

import {
  BUILTIN_RULES,
  adoptDraftRules,
  buildExtractSignalsScript,
  dismissDraftRules,
  getActiveRules,
  getDraftRules,
  rollbackToBuiltinRules,
  sanitizeRuleSet,
  saveDraftRules,
} from '../extraction-rules';
import {
  countOpenRepairTickets,
  listOpenRepairTickets,
  openRepairTicket,
  resolveOpenRepairTickets,
} from '../repair-tickets';

function makeStore(): AppDataStore {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  return createAppDataStore(db, 'amazon-rank');
}

describe('sanitizeRuleSet', () => {
  it('空/超长字段回退出厂基线，数组去重去空并截断', () => {
    const dirty = sanitizeRuleSet({
      resultSelector: '   ',
      asinAttribute: 'x'.repeat(500),
      adTextMarkers: ['Sponsored', 'Sponsored', '', 'Ad', ...Array(20).fill('junk')],
    });
    expect(dirty.resultSelector).toBe(BUILTIN_RULES.resultSelector);
    expect(dirty.asinAttribute).toBe(BUILTIN_RULES.asinAttribute);
    expect(dirty.adTextMarkers.slice(0, 2)).toEqual(['Sponsored', 'Ad']);
    expect(dirty.adTextMarkers.length).toBeLessThanOrEqual(10);
  });
});

describe('buildExtractSignalsScript', () => {
  it('规则作为 JSON 数据注入，特殊字符不会破坏脚本结构', () => {
    const script = buildExtractSignalsScript({
      ...BUILTIN_RULES,
      adTextMarkers: ['say "hi"', "it's"],
    });
    expect(script).toContain('"say \\"hi\\""');
    expect(script).toContain('querySelectorAll(R.resultSelector)');
    // 脚本必须是合法 JS（能被解析），直接 new Function 验证语法
    expect(() => new Function(`return ${script.replace(/^\(|\)\(\)$/g, '')}`)).not.toThrow();
  });
});

describe('规则生命周期', () => {
  it('无存储规则时生效出厂基线 v0', () => {
    const store = makeStore();
    const active = getActiveRules(store);
    expect(active.version).toBe(0);
    expect(active.source).toBe('builtin');
    expect(active.rules).toEqual(BUILTIN_RULES);
  });

  it('草稿不影响生效规则；采用后转正；回滚回出厂', () => {
    const store = makeStore();
    const draft = saveDraftRules(
      store,
      { ...BUILTIN_RULES, resultSelector: '[data-cy="result"]' },
      { note: '亚马逊改版', validatedKeywords: ['kw1', 'kw2'] },
    );
    expect(getActiveRules(store).source).toBe('builtin'); // 草稿未确认不生效

    adoptDraftRules(store, draft.id);
    const active = getActiveRules(store);
    expect(active.source).toBe('ai');
    expect(active.version).toBe(1);
    expect(active.rules.resultSelector).toBe('[data-cy="result"]');
    expect(getDraftRules(store)).toBeNull();

    rollbackToBuiltinRules(store);
    expect(getActiveRules(store).source).toBe('builtin');
  });

  it('新草稿顶掉旧草稿；忽略草稿归档；版本号单调递增', () => {
    const store = makeStore();
    const d1 = saveDraftRules(store, BUILTIN_RULES, { validatedKeywords: ['a'] });
    const d2 = saveDraftRules(store, BUILTIN_RULES, { validatedKeywords: ['b'] });
    expect(d2.version).toBeGreaterThan(d1.version);
    expect(getDraftRules(store)?.id).toBe(d2.id);

    dismissDraftRules(store, d2.id);
    expect(getDraftRules(store)).toBeNull();
    expect(() => adoptDraftRules(store, d2.id)).toThrow('草稿不存在或已被处理');
  });
});

describe('修复工单', () => {
  it('同关键词只留一张未决工单；采用规则时批量解决', () => {
    const store = makeStore();
    openRepairTicket(store, { runId: 'r1', seq: 1, keyword: 'yoga mat', reason: '没有结果节点' });
    openRepairTicket(store, { runId: 'r2', seq: 3, keyword: 'YOGA MAT', reason: '全是广告位' });
    openRepairTicket(store, { runId: 'r2', seq: 4, keyword: 'bottle', reason: '没有结果节点' });
    expect(countOpenRepairTickets(store)).toBe(2);
    expect(listOpenRepairTickets(store).find((t) => t.keyword === 'yoga mat')?.reason).toBe('全是广告位');

    const resolved = resolveOpenRepairTickets(store, 3);
    expect(resolved).toBe(2);
    expect(countOpenRepairTickets(store)).toBe(0);
  });
});
