import { markdownToFeishuCard, splitCard } from '../feishu-card';

describe('Markdown to Feishu Card', () => {
  it('converts heading', () => {
    const card = markdownToFeishuCard('## Test');
    expect(card.body.elements[0].text.content).toContain('## Test');
  });

  it('converts code block', () => {
    const card = markdownToFeishuCard('```js\nconst x = 1;\n```');
    expect(card.body.elements[0].tag).toBe('code_block');
    expect(card.body.elements[0].language).toBe('javascript');
  });

  it('converts list', () => {
    const card = markdownToFeishuCard('- Item 1\n- Item 2');
    expect(card.body.elements[0].text.content).toContain('- Item 1');
  });

  it('converts table', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const card = markdownToFeishuCard(md);
    expect(card.body.elements[0].tag).toBe('table');
    expect(card.body.elements[0].columns).toHaveLength(2);
  });

  it('adds header', () => {
    const card = markdownToFeishuCard('Test', { title: 'AI' });
    expect(card.header?.title.content).toBe('AI');
  });
});

describe('splitCard', () => {
  it('splits large cards', () => {
    const elements = Array(60).fill({ tag: 'div', text: { tag: 'lark_md', content: 'x' } });
    const chunks = splitCard(elements);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
