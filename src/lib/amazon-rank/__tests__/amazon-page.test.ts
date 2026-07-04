import { buildSearchUrl, classifySignals, parseExtractSignals } from '../amazon-page';

describe('buildSearchUrl', () => {
  it('拼站点搜索 URL 并编码关键词', () => {
    expect(buildSearchUrl('www.amazon.com', 'yoga mat 6mm')).toBe(
      'https://www.amazon.com/s?k=yoga%20mat%206mm',
    );
  });
});

describe('parseExtractSignals', () => {
  it('解析提取脚本返回的 JSON 字符串', () => {
    const signals = parseExtractSignals(
      JSON.stringify({ organicAsins: ['B0A', ''], resultNodeCount: 5, captcha: false, noResults: false }),
    );
    expect(signals).toEqual({
      organicAsins: ['B0A'],
      resultNodeCount: 5,
      captcha: false,
      noResults: false,
    });
  });

  it('非法输入返回 null', () => {
    expect(parseExtractSignals(undefined)).toBeNull();
    expect(parseExtractSignals('not json')).toBeNull();
    expect(parseExtractSignals('')).toBeNull();
  });
});

describe('classifySignals — 错误三分类', () => {
  const base = { organicAsins: [], resultNodeCount: 0, captcha: false, noResults: false };

  it('验证码 → blocked（优先级最高）', () => {
    const c = classifySignals({ ...base, captcha: true, organicAsins: ['B0A'] });
    expect(c.status).toBe('blocked');
    expect(c.message).toContain('验证码');
  });

  it('有自然位 → ok', () => {
    expect(classifySignals({ ...base, organicAsins: ['B0A'], resultNodeCount: 3 }).status).toBe('ok');
  });

  it('页面明确无结果 → no_results', () => {
    expect(classifySignals({ ...base, noResults: true }).status).toBe('no_results');
  });

  it('没有结果节点 → parse_failed（改版或未加载）', () => {
    const c = classifySignals(base);
    expect(c.status).toBe('parse_failed');
    expect(c.message).toContain('没有搜索结果节点');
  });

  it('有节点但全被判广告 → parse_failed（提取规则失效）', () => {
    const c = classifySignals({ ...base, resultNodeCount: 8 });
    expect(c.status).toBe('parse_failed');
    expect(c.message).toContain('广告');
  });

  it('提取脚本没返回数据 → parse_failed', () => {
    expect(classifySignals(null).status).toBe('parse_failed');
  });
});
