import { composeResearchReport } from '../research-compose';

describe('composeResearchReport', () => {
  it('renders a markdown report with title, summary, per-source detail and action block', () => {
    const { markdown, summary } = composeResearchReport({
      platform: 'etsy',
      query: '手作陶瓷杯',
      instruction: '关注礼物属性 + 包装',
      sourceResults: [
        {
          source: 'web',
          ok: true,
          latency_ms: 120,
          items: [
            { title: 'Top mug A', url: 'https://etsy.com/listing/1', snippet: '热销手作' },
            { title: 'Top mug B', url: 'https://etsy.com/listing/2', score: 0.91 },
          ],
        },
        {
          source: 'deepsearch',
          ok: false,
          error: 'site not configured',
          items: [],
        },
      ],
      generatedAt: '2026-05-13T12:00:00.000Z',
    });

    expect(markdown).toContain('# etsy 调研报告：手作陶瓷杯');
    expect(markdown).toContain('2026-05-13T12:00:00.000Z');
    expect(markdown).toContain('用户指令：关注礼物属性 + 包装');
    expect(markdown).toContain('## 数据源：web');
    expect(markdown).toContain('## 数据源：deepsearch');
    expect(markdown).toContain('❌ 失败');
    expect(markdown).toContain('Top mug A');
    expect(markdown).toContain('https://etsy.com/listing/1');
    expect(markdown).toContain('## 行动建议');
    expect(summary).toContain('etsy');
    expect(summary).toContain('手作陶瓷杯');
    expect(summary).toContain('1/2 源');
    expect(summary).toContain('2 条');
  });

  it('emits a "no data" action hint when every source returned zero items', () => {
    const { markdown } = composeResearchReport({
      platform: 'amazon',
      query: '空查询',
      instruction: null,
      sourceResults: [{ source: 'web', ok: true, items: [] }],
    });
    expect(markdown).toMatch(/检查所选平台|无有效条目/);
  });

  it('renders the AI 洞察 sections when analysis is provided', () => {
    const { markdown } = composeResearchReport({
      platform: 'etsy',
      query: '手作陶瓷杯',
      instruction: null,
      sourceResults: [{ source: 'web', ok: true, items: [{ title: 'Mug A' }] }],
      analysis: {
        executive_summary: 'Demand stable at $25-40 band.',
        key_findings: ['礼物属性', '高评分集中度'],
        competitive_landscape: '小工坊主导',
        pricing_observations: '$28-38',
        recommended_actions: ['切入礼盒', '生活方式拍摄'],
      },
    });
    expect(markdown).toContain('## AI 洞察');
    expect(markdown).toContain('Demand stable at $25-40 band.');
    expect(markdown).toContain('### 关键发现');
    expect(markdown).toContain('- 礼物属性');
    expect(markdown).toContain('### 竞争格局');
    expect(markdown).toContain('小工坊主导');
    expect(markdown).toContain('### 价格观察');
    expect(markdown).toContain('### 推荐动作');
    expect(markdown).toContain('1. 切入礼盒');
  });

  it('skips AI 洞察 sections when analysis is null (LLM unavailable fallback)', () => {
    const { markdown } = composeResearchReport({
      platform: 'etsy',
      query: 'q',
      instruction: null,
      sourceResults: [{ source: 'web', ok: true, items: [{ title: 'A' }] }],
      analysis: null,
    });
    expect(markdown).not.toContain('## AI 洞察');
  });

  it('truncates source items beyond 20 with a hint', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ title: `Item ${i}` }));
    const { markdown } = composeResearchReport({
      platform: 'etsy',
      query: 'q',
      instruction: null,
      sourceResults: [{ source: 'web', ok: true, items }],
    });
    expect(markdown).toContain('还有 10 条未展示');
  });
});
