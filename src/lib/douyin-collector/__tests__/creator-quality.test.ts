import { creatorQualityTier } from '../creator-quality';

describe('creatorQualityTier', () => {
  it('returns "none" when no videos collected', () => {
    expect(creatorQualityTier({ collected: 0, transcribed: 0, published: 0 })).toEqual({
      tier: 'none',
      publishRate: null,
    });
  });

  it('returns "none" for samples below threshold (<5) — small N is noise', () => {
    // 1 of 3 published is technically 33% but we don't trust the signal yet
    const r = creatorQualityTier({ collected: 3, transcribed: 2, published: 1 });
    expect(r.tier).toBe('none');
    // Rate is still computed for the tooltip — caller may want to show "X/Y" anyway
    expect(r.publishRate).toBeCloseTo(1 / 3);
  });

  it('classifies "high" when publish rate >= 50% and samples >= 5', () => {
    expect(creatorQualityTier({ collected: 10, transcribed: 9, published: 5 }).tier).toBe('high');
    expect(creatorQualityTier({ collected: 10, transcribed: 10, published: 10 }).tier).toBe('high');
    expect(creatorQualityTier({ collected: 6, transcribed: 6, published: 3 }).tier).toBe('high');
  });

  it('classifies "medium" for 20% <= rate < 50%', () => {
    expect(creatorQualityTier({ collected: 10, transcribed: 8, published: 2 }).tier).toBe('medium');
    expect(creatorQualityTier({ collected: 10, transcribed: 9, published: 4 }).tier).toBe('medium');
  });

  it('classifies "low" for rate < 20% (with enough samples)', () => {
    expect(creatorQualityTier({ collected: 10, transcribed: 8, published: 1 }).tier).toBe('low');
    expect(creatorQualityTier({ collected: 50, transcribed: 30, published: 0 }).tier).toBe('low');
  });

  it('boundary: exactly 50% is "high", exactly 20% is "medium"', () => {
    expect(creatorQualityTier({ collected: 10, transcribed: 0, published: 5 }).tier).toBe('high');
    expect(creatorQualityTier({ collected: 10, transcribed: 0, published: 2 }).tier).toBe('medium');
  });

  it('boundary: just below 5 samples is still "none" — gate is strict', () => {
    expect(creatorQualityTier({ collected: 4, transcribed: 4, published: 4 }).tier).toBe('none');
    // 5 is the first qualifying sample
    expect(creatorQualityTier({ collected: 5, transcribed: 5, published: 5 }).tier).toBe('high');
  });
});
