/**
 * 回归护栏：用户实测投诉「调研 tab 一堆脏数据」——web 源全失败却报「2 条」，
 * 占位提示被当真实数据编号渲染，AI 洞察基于失败态编整页空话。
 * 锁定 notice 不冒充数据 + 零真实数据时的诚实行为。
 */
const mockGenerateStructured = jest.fn();
jest.mock('../llm-client', () => ({
  generateStructured: (...a: unknown[]) => mockGenerateStructured(...a),
  EcommerceLlmUnavailableError: class extends Error {},
}));

import { composeResearchReport } from '../research-compose';
import { analyzeResearch } from '../research-analyze';
import { notice, countDataItems, type ResearchSourceResult } from '../research-sources';

// 复刻用户那份脏报告的输入：web 失败，deepsearch/douyin 只有占位提示。
const dirtyInput: ResearchSourceResult[] = [
  { source: 'web', ok: false, error: 'Browser Bridge 未连接; 退回 server fetch: HTTP 403', items: [] },
  { source: 'deepsearch', ok: true, latency_ms: 42, items: [notice('没有匹配 DeepSearch 站点', '可用 keys：zhihu, wechat')] },
  { source: 'douyin', ok: true, latency_ms: 2, items: [notice('当前任务未指向抖音平台', 'platform=etsy')] },
];

beforeEach(() => jest.clearAllMocks());

describe('countDataItems', () => {
  it('counts only real data, never notices, never failed sources', () => {
    expect(countDataItems(dirtyInput[0])).toBe(0); // failed
    expect(countDataItems(dirtyInput[1])).toBe(0); // notice-only
    expect(
      countDataItems({ source: 'web', ok: true, items: [{ title: 'Mug A' }, notice('hint')] }),
    ).toBe(1); // 1 data + 1 notice → 1
  });
});

describe('composeResearchReport — 脏数据场景', () => {
  it('reports 0 真实条目 (not 2) and surfaces the no-data warning', () => {
    const { markdown, summary } = composeResearchReport({
      platform: 'etsy',
      query: '景德镇陶瓷手链',
      instruction: null,
      sourceResults: dirtyInput,
    });
    expect(summary).toContain('0 条');
    expect(markdown).toContain('0 条（仅真实数据');
    expect(markdown).toContain('未采集到任何真实数据');
    // 占位不得被当数据编号渲染
    expect(markdown).not.toMatch(/1\.\s+\*\*没有匹配 DeepSearch 站点\*\*/);
    // 但提示仍要可见（非数据区）
    expect(markdown).toContain('ℹ️ 提示（非数据）');
    expect(markdown).toContain('没有匹配 DeepSearch 站点');
    // 行动建议必须走「零数据不能选品」诚实分支，不得叫用户导入高分条目
    expect(markdown).toContain('不能用于选品决策');
    expect(markdown).not.toContain('把高分条目导入候选');
  });

  it('still counts genuine data items and renders them numbered', () => {
    const { markdown, summary } = composeResearchReport({
      platform: 'etsy',
      query: 'q',
      instruction: null,
      sourceResults: [
        {
          source: 'web',
          ok: true,
          items: [
            { title: 'Real Mug', url: 'https://etsy.com/listing/9', snippet: '价格 $30' },
            notice('继续深挖建议', '去 DeepSearch 跑一轮'),
          ],
        },
      ],
    });
    expect(summary).toContain('1 条');
    expect(markdown).toMatch(/1\.\s+\*\*Real Mug\*\*/);
    expect(markdown).toContain('数据条目：1 · 提示：1');
  });
});

describe('analyzeResearch — 零真实数据', () => {
  it('returns null WITHOUT calling the LLM (no fabricated empty analysis)', async () => {
    const result = await analyzeResearch({
      platform: 'etsy',
      query: '景德镇陶瓷手链',
      instruction: null,
      sourceResults: dirtyInput,
    });
    expect(result).toBeNull();
    expect(mockGenerateStructured).not.toHaveBeenCalled();
  });
});
