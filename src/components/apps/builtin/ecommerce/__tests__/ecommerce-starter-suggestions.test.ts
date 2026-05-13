import { ECOMMERCE_STARTER_SUGGESTIONS } from '../ecommerce-starter-suggestions';

describe('ecommerce starter suggestions', () => {
  it('exposes between 3 and 8 suggestions so the chip row stays scannable', () => {
    expect(ECOMMERCE_STARTER_SUGGESTIONS.length).toBeGreaterThanOrEqual(3);
    expect(ECOMMERCE_STARTER_SUGGESTIONS.length).toBeLessThanOrEqual(8);
  });

  it('gives every suggestion a stable id, a short label, and a non-empty prompt', () => {
    for (const s of ECOMMERCE_STARTER_SUGGESTIONS) {
      expect(s.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.label.length).toBeLessThanOrEqual(20);
      expect(s.prompt.trim().length).toBeGreaterThan(10);
    }
  });

  it('does not duplicate ids', () => {
    const ids = ECOMMERCE_STARTER_SUGGESTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers at least one in-app navigation question and one general ecommerce question', () => {
    const prompts = ECOMMERCE_STARTER_SUGGESTIONS.map((s) => s.prompt).join('\n');
    expect(prompts).toMatch(/工坊|预设|任务|资料库|应用|标签/);
    expect(prompts).toMatch(/Etsy|主图|listing|生活方式|文案|平台/i);
  });
});
