import { buildWorkflowDsl, currentWeekId } from '../workflow.dsl';
import { validateWorkflowDslV3 } from '@/lib/workflow/dsl-v3-schema';
import { DEFAULT_RUN_PARAMS } from '../types';

const FAKE_AGENT_ID = 'fake-agent-preset-id';
const opts = { agentPresetId: FAKE_AGENT_ID };

describe('buildWorkflowDsl', () => {
  test('单平台模式不生成 parallel/join', () => {
    const dsl = buildWorkflowDsl({
      ...DEFAULT_RUN_PARAMS,
      platforms: ['fanqie'],
    }, opts);
    expect(dsl.nodes.find((n) => n.type === 'parallel')).toBeUndefined();
    expect(dsl.nodes.find((n) => n.type === 'join')).toBeUndefined();
    // 仍有 fetch_rankings_fanqie + dedup + for_each + body × 4 + analyze + 2 × persist
    expect(dsl.nodes.find((n) => n.id === 'fetch_rankings_fanqie')).toBeDefined();
    expect(dsl.nodes.find((n) => n.id === 'dedup')).toBeDefined();
    expect(dsl.nodes.find((n) => n.id === 'for_each_books')).toBeDefined();
  });

  test('多平台模式生成 parallel + join', () => {
    const dsl = buildWorkflowDsl({
      ...DEFAULT_RUN_PARAMS,
      platforms: ['fanqie', 'qidian', 'jjwxc', 'qimao'],
    }, opts);
    expect(dsl.nodes.find((n) => n.type === 'parallel')).toBeDefined();
    expect(dsl.nodes.find((n) => n.type === 'join')).toBeDefined();
    expect(dsl.nodes.filter((n) => n.id.startsWith('fetch_rankings_'))).toHaveLength(4);
  });

  test('inline 节点齐全', () => {
    const dsl = buildWorkflowDsl({
      ...DEFAULT_RUN_PARAMS,
      platforms: ['fanqie'],
    }, opts);
    const ids = dsl.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([
      'fetch_rankings_fanqie',
      'dedup',
      'for_each_books',
      'fetch_detail',
      'aggregate',
    ]));
  });

  test('for_each → fetch_detail 是 body 边', () => {
    const dsl = buildWorkflowDsl({
      ...DEFAULT_RUN_PARAMS,
      platforms: ['fanqie'],
    }, opts);
    const bodyEdge = dsl.edges.find(
      (e) => e.from === 'for_each_books' && e.to === 'fetch_detail',
    );
    expect(bodyEdge?.kind).toBe('body');
  });

  test('aggregate 是终端 (无出边)', () => {
    const dsl = buildWorkflowDsl({
      ...DEFAULT_RUN_PARAMS,
      platforms: ['fanqie'],
    }, opts);
    expect(dsl.edges.find((e) => e.from === 'aggregate')).toBeUndefined();
  });

  test('每个 agent 节点的 script 都是非空 inline 字符串', () => {
    const dsl = buildWorkflowDsl({
      ...DEFAULT_RUN_PARAMS,
      platforms: ['fanqie'],
    }, opts);
    type WithCode = {
      type: string;
      input?: { code?: { script?: string; handler?: string } };
    };
    for (const n of dsl.nodes as unknown as WithCode[]) {
      if (n.type !== 'agent') continue;
      expect(n.input?.code?.script).toBeTruthy();
      expect(n.input?.code?.script?.length).toBeGreaterThan(20);
      expect(n.input?.code?.handler).toBeUndefined();
    }
  });

  test('V3 schema 校验通过 (单平台)', () => {
    const dsl = buildWorkflowDsl({
      ...DEFAULT_RUN_PARAMS,
      platforms: ['fanqie'],
    }, opts);
    const r = validateWorkflowDslV3(dsl);
    expect(r.valid).toBe(true);
    if (!r.valid) {
      // print errors for debugging
      throw new Error(`V3 validation failed: ${JSON.stringify(r.errors, null, 2)}`);
    }
  });

  test('V3 schema 校验通过 (4 平台)', () => {
    const dsl = buildWorkflowDsl({
      ...DEFAULT_RUN_PARAMS,
      platforms: ['fanqie', 'qidian', 'jjwxc', 'qimao'],
    }, opts);
    const r = validateWorkflowDslV3(dsl);
    expect(r.valid).toBe(true);
    if (!r.valid) {
      throw new Error(`V3 validation failed: ${JSON.stringify(r.errors, null, 2)}`);
    }
  });

  test('topN 透传到 rankings 节点 params', () => {
    const dsl = buildWorkflowDsl({
      ...DEFAULT_RUN_PARAMS,
      platforms: ['fanqie'],
      topN: 7,
    }, opts);
    const rankNode = dsl.nodes.find((n) => n.id === 'fetch_rankings_fanqie')!;
    type WithCode = { input: { code: { params: { topN: number } } } };
    const params = (rankNode as unknown as WithCode).input.code.params;
    expect(params.topN).toBe(7);
  });

  test('maxIterations = topN × platforms.length', () => {
    const dsl = buildWorkflowDsl({
      ...DEFAULT_RUN_PARAMS,
      platforms: ['fanqie', 'qidian'],
      topN: 30,
    }, opts);
    const forEach = dsl.nodes.find((n) => n.id === 'for_each_books')!;
    type WithFE = { input: { maxIterations?: number } };
    expect((forEach as unknown as WithFE).input.maxIterations).toBe(60);
  });
});

describe('currentWeekId', () => {
  test('格式为 YYYY-Wnn', () => {
    const id = currentWeekId();
    expect(id).toMatch(/^\d{4}-W\d{2}$/);
  });

  test('给定具体日期产生稳定结果', () => {
    const monday = new Date(Date.UTC(2026, 4, 4)); // 2026-05-04 Monday
    const id = currentWeekId(monday);
    expect(id).toMatch(/^2026-W\d{2}$/);
  });
});
