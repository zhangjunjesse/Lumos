import { proposeRulesWithAi, readPageWithAi, type StructuredGenerate } from '../ai-operator';
import { BUILTIN_RULES } from '../extraction-rules';
import type { PageDigest } from '../page-digest';

const digest: PageDigest = {
  title: 'Amazon.com : yoga mat',
  url: 'https://www.amazon.com/s?k=yoga+mat',
  bodyTextHead: 'results',
  cards: [],
};

function fakeGenerate(result: Record<string, unknown>): StructuredGenerate {
  return (async () => result) as unknown as StructuredGenerate;
}

describe('readPageWithAi', () => {
  it('清洗 ASIN：大写化、过滤非法、去重、截断 topN', async () => {
    const read = await readPageWithAi(
      fakeGenerate({
        organicAsins: ['b0aaaaaaa1', 'B0AAAAAAA1', 'not-asin', 'B0BBBBBBB2', 'B0CCCCCCC3'],
        captcha: false,
        noResults: false,
      }),
      '识别自然位',
      digest,
      2,
    );
    expect(read.organicAsins).toEqual(['B0AAAAAAA1', 'B0BBBBBBB2']);
    expect(read.captcha).toBe(false);
  });

  it('用户提示词进入 system，输出契约固定追加', async () => {
    let seenSystem = '';
    const generate = (async (args: { system: string }) => {
      seenSystem = args.system;
      return { organicAsins: [], captcha: false, noResults: true };
    }) as unknown as StructuredGenerate;

    const read = await readPageWithAi(generate, '我的自定义提示词', digest, 20);
    expect(seenSystem).toContain('我的自定义提示词');
    expect(seenSystem).toContain('organicAsins');
    expect(read.noResults).toBe(true);
  });
});

describe('proposeRulesWithAi', () => {
  it('提案经过 sanitize：空关键字段回退出厂，rationale 截断', async () => {
    const proposal = await proposeRulesWithAi(
      fakeGenerate({
        resultSelector: '[data-test="v2"]',
        asinAttribute: '',
        adTextMarkers: ['Sponsored'],
        rationale: 'x'.repeat(1000),
      }),
      digest,
      ['B0AAAAAAA1'],
      BUILTIN_RULES,
    );
    expect(proposal.rules.resultSelector).toBe('[data-test="v2"]');
    expect(proposal.rules.asinAttribute).toBe(BUILTIN_RULES.asinAttribute); // 空值回退
    expect(proposal.rules.noResultsPatterns).toEqual(BUILTIN_RULES.noResultsPatterns);
    expect(proposal.rationale.length).toBeLessThanOrEqual(500);
  });
});
