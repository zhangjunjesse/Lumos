import { markdownToFeishuCard, splitCard } from '../feishu-card';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Markdown to Feishu Card', () => {
  it('converts heading', () => {
    const card = markdownToFeishuCard('## Test');
    assert.ok(String(card.body.elements[0].text.content).includes('## Test'));
  });

  it('converts code block', () => {
    const card = markdownToFeishuCard('```js\nconst x = 1;\n```');
    assert.equal(card.body.elements[0].tag, 'code_block');
    assert.equal(card.body.elements[0].language, 'javascript');
  });

  it('converts list', () => {
    const card = markdownToFeishuCard('- Item 1\n- Item 2');
    assert.ok(String(card.body.elements[0].text.content).includes('- Item 1'));
  });

  it('converts table', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const card = markdownToFeishuCard(md);
    assert.equal(card.body.elements[0].tag, 'table');
    assert.equal((card.body.elements[0].columns || []).length, 2);
  });

  it('adds header', () => {
    const card = markdownToFeishuCard('Test', { title: 'AI' });
    assert.equal(card.header?.title.content, 'AI');
  });
});

describe('splitCard', () => {
  it('splits large cards', () => {
    const elements = Array(60).fill({ tag: 'div', text: { tag: 'lark_md', content: 'x' } });
    const chunks = splitCard(elements);
    assert.ok(chunks.length > 1);
  });
});
