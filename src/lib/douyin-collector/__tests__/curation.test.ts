import { computeCurationCompleteness } from '../curation';

describe('computeCurationCompleteness', () => {
  it('returns 0/3 for an empty/uninitialized video', () => {
    const r = computeCurationCompleteness({});
    expect(r.score).toBe(0);
    expect(r.total).toBe(3);
    expect(r.missing).toEqual(['字幕', '标签', '备注']);
  });

  it('counts each pillar independently', () => {
    expect(computeCurationCompleteness({ transcript_status: 'success' }).score).toBe(1);
    expect(computeCurationCompleteness({ tags: '["ai"]' }).score).toBe(1);
    expect(computeCurationCompleteness({ notes: 'my notes' }).score).toBe(1);
  });

  it('whitespace-only notes do not count', () => {
    expect(computeCurationCompleteness({ notes: '\t\n' }).score).toBe(0);
  });

  it('only transcript_status=success counts; pending/failed are incomplete', () => {
    expect(computeCurationCompleteness({ transcript_status: 'pending' }).score).toBe(0);
    expect(computeCurationCompleteness({ transcript_status: 'failed' }).score).toBe(0);
    expect(computeCurationCompleteness({ transcript_status: 'success' }).score).toBe(1);
  });

  it('tags requires at least one item after parsing (handles JSON / CSV / CJK)', () => {
    expect(computeCurationCompleteness({ tags: '[]' }).score).toBe(0);
    expect(computeCurationCompleteness({ tags: '' }).score).toBe(0);
    expect(computeCurationCompleteness({ tags: '["a"]' }).score).toBe(1);
    expect(computeCurationCompleteness({ tags: 'a, b, c' }).score).toBe(1);
    expect(computeCurationCompleteness({ tags: '一， 二' }).score).toBe(1);
  });

  it('full curation returns 3/3 with empty missing', () => {
    const r = computeCurationCompleteness({
      transcript_status: 'success',
      tags: '["ai"]',
      notes: 'studied this',
    });
    expect(r.score).toBe(3);
    expect(r.missing).toEqual([]);
  });

  it('missing list preserves the canonical order: 字幕 / 标签 / 备注', () => {
    const r = computeCurationCompleteness({ tags: '["ai"]' });
    expect(r.missing).toEqual(['字幕', '备注']);
  });
});
