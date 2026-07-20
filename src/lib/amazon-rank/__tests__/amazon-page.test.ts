import { buildSearchUrl, classifySignals, ensureDeliveryZip, parseExtractSignals } from '../amazon-page';

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

describe('ensureDeliveryZip — 处理「Choose your location」模态', () => {
  const noSleep = async () => {};

  // snapshot 第一次返回 before,之后返回 after;记录每次 evaluate 的脚本
  function makeApi(beforeContent: string, afterContent: string) {
    const scripts: string[] = [];
    let snaps = 0;
    const api = {
      waitFor: async () => {},
      snapshot: async () => ({ title: 't', content: (snaps++ === 0 ? beforeContent : afterContent) }),
      evaluate: async (script: string) => {
        scripts.push(script);
        return 'ok';
      },
    };
    return { api, scripts };
  }

  it('填邮编 + 点 Apply + 点 Done 关弹窗,并按快照确认结果', async () => {
    const { api, scripts } = makeApi('Delivering to Los Angeles 90009', 'Deliver to New York 10001');
    const ok = await ensureDeliveryZip(api, '10001', noSleep);
    expect(ok).toBe(true);
    const joined = scripts.join('\n');
    expect(joined).toContain('#GLUXZipUpdateInput'); // 填框
    expect(joined).toContain('10001'); // 填的值
    expect(joined).toContain('#GLUXZipUpdate'); // 点 Apply
    expect(joined).toContain('glowDoneButton'); // 点 Done(关弹窗)——旧实现缺的正是这两步
  });

  it('邮编已是目标值 → 直接返回,不动弹窗', async () => {
    const { api, scripts } = makeApi('Deliver to New York 10001', 'Deliver to New York 10001');
    const ok = await ensureDeliveryZip(api, '10001', noSleep);
    expect(ok).toBe(true);
    expect(scripts).toHaveLength(0);
  });

  it('设不上邮编 → 返回 false,但仍点 Done 兜底关弹窗', async () => {
    const { api, scripts } = makeApi('Delivering to Los Angeles 90009', 'Delivering to Los Angeles 90009');
    const ok = await ensureDeliveryZip(api, '10001', noSleep);
    expect(ok).toBe(false);
    expect(scripts.join('\n')).toContain('glowDoneButton');
  });
});
