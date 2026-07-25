// 提示词清单字段渲染回归:折叠换行(否则一条会被撑成多行、模型读错条目边界)、截断、引号转义。

import { PROMPT_FIELD_MAX, quotePromptField } from '../prompt-field';

describe('quotePromptField', () => {
  it('把换行和连续空白折叠成单空格,保证一条只占一行', () => {
    const out = quotePromptField('先调研\n再写稿\t\t然后   审核');
    expect(out).toBe('"先调研 再写稿 然后 审核"');
    expect(out).not.toContain('\n');
  });

  it('首尾空白清掉', () => {
    expect(quotePromptField('  内容组  ')).toBe('"内容组"');
  });

  it('引号被转义,不会破坏 key: "value" 结构', () => {
    expect(quotePromptField('叫"内容组"的团队')).toBe('"叫\\"内容组\\"的团队"');
  });

  it('超长截断并补省略号', () => {
    const long = 'a'.repeat(PROMPT_FIELD_MAX + 50);
    const parsed = JSON.parse(quotePromptField(long)) as string;
    expect(parsed).toHaveLength(PROMPT_FIELD_MAX);
    expect(parsed.endsWith('…')).toBe(true);
  });

  it('恰好等于上限时不截断', () => {
    const exact = 'b'.repeat(PROMPT_FIELD_MAX);
    expect(JSON.parse(quotePromptField(exact))).toBe(exact);
  });

  it('可覆盖上限', () => {
    expect(JSON.parse(quotePromptField('abcdef', 3))).toBe('ab…');
  });
});
