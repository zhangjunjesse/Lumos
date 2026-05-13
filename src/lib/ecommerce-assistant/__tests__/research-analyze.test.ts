const mockGenerateStructured = jest.fn();

jest.mock('../llm-client', () => ({
  generateStructured: (...args: unknown[]) => mockGenerateStructured(...args),
  EcommerceLlmUnavailableError: class EcommerceLlmUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'EcommerceLlmUnavailableError';
    }
  },
}));

import { EcommerceLlmUnavailableError } from '../llm-client';
import { analyzeResearch } from '../research-analyze';

const baseArgs = {
  platform: 'etsy',
  query: '手作陶瓷杯',
  instruction: '关注礼物属性',
  sourceResults: [
    {
      source: 'web',
      ok: true,
      items: [
        { title: 'Mug A', url: 'https://etsy.com/listing/1', snippet: '价格 $32 · 评分 4.8' },
      ],
    },
  ],
};

beforeEach(() => jest.clearAllMocks());

describe('analyzeResearch', () => {
  it('passes a compact source dump + schema-ed prompt to generateStructured and returns its result', async () => {
    mockGenerateStructured.mockResolvedValueOnce({
      executive_summary: 'Demand for handmade mugs holds strong in the $25-40 band.',
      key_findings: ['礼物属性吃香', '上半年评论数翻倍'],
      competitive_landscape: '十余家小工坊主导',
      pricing_observations: '$28-38 主流',
      recommended_actions: ['切入礼物礼盒赛道', '试拍生活方式图'],
    });

    const result = await analyzeResearch(baseArgs);

    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
    const call = mockGenerateStructured.mock.calls[0][0];
    expect(call.system).toMatch(/调研报告/);
    expect(call.prompt).toContain('etsy');
    expect(call.prompt).toContain('手作陶瓷杯');
    expect(call.prompt).toContain('关注礼物属性');
    expect(call.prompt).toContain('Mug A');
    expect(result?.executive_summary).toContain('handmade');
    expect(result?.key_findings).toHaveLength(2);
  });

  it('returns null (not throw) when LLM provider is unavailable', async () => {
    mockGenerateStructured.mockRejectedValueOnce(
      new EcommerceLlmUnavailableError('no provider'),
    );
    const result = await analyzeResearch(baseArgs);
    expect(result).toBeNull();
  });

  it('rethrows non-availability errors so the runner can record them', async () => {
    mockGenerateStructured.mockRejectedValueOnce(new Error('schema validation failed'));
    await expect(analyzeResearch(baseArgs)).rejects.toThrow('schema validation failed');
  });

  it('truncates each source result to the first 8 items in the prompt', async () => {
    mockGenerateStructured.mockResolvedValueOnce({
      executive_summary: '...',
      key_findings: [],
      recommended_actions: [],
    });

    await analyzeResearch({
      ...baseArgs,
      sourceResults: [
        {
          source: 'web',
          ok: true,
          items: Array.from({ length: 20 }, (_, i) => ({ title: `Item ${i}` })),
        },
      ],
    });

    const prompt = mockGenerateStructured.mock.calls[0][0].prompt;
    expect(prompt).toContain('Item 0');
    expect(prompt).toContain('Item 7');
    expect(prompt).not.toContain('Item 8');
  });
});
