import { appendTag } from '../tag-helpers';

describe('appendTag', () => {
  it('appends to an empty string', () => {
    expect(appendTag('', 'AI')).toBe('AI');
  });

  it('appends to a non-empty list with canonical ", " separator', () => {
    expect(appendTag('AI', 'cache')).toBe('AI, cache');
    expect(appendTag('AI, prompt', 'caching')).toBe('AI, prompt, caching');
  });

  it('is a no-op when the tag is already present (case-insensitive)', () => {
    expect(appendTag('AI', 'ai')).toBe('AI');
    expect(appendTag('AI, Prompt', 'PROMPT')).toBe('AI, Prompt');
  });

  it('preserves existing casing when adding a different tag', () => {
    expect(appendTag('AI', 'cache')).toBe('AI, cache');
  });

  it('treats blank / whitespace-only tag as no-op', () => {
    expect(appendTag('AI', '')).toBe('AI');
    expect(appendTag('AI', '   ')).toBe('AI');
  });

  it('trims surrounding whitespace from the appended tag', () => {
    expect(appendTag('AI', '  cache  ')).toBe('AI, cache');
  });

  it('handles JSON-array input (parseVideoTags also reads canonical JSON)', () => {
    expect(appendTag('["AI","prompt"]', 'cache')).toBe('AI, prompt, cache');
  });

  it('handles 全角 separators on the existing input', () => {
    // parseVideoTags supports CJK fullwidth comma / semicolon
    expect(appendTag('AI， prompt； cache', 'rate-limit')).toBe('AI, prompt, cache, rate-limit');
  });
});
