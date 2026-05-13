import { parseVideoSort, sortVideos, type SortableVideo } from '../sort-helpers';

const mk = (v: Partial<SortableVideo> & { id: string }): SortableVideo & { id: string } => ({
  ...v,
});

describe('parseVideoSort', () => {
  it('returns the sort when whitelisted', () => {
    expect(parseVideoSort('newest')).toBe('newest');
    expect(parseVideoSort('oldest')).toBe('oldest');
    expect(parseVideoSort('longest')).toBe('longest');
    expect(parseVideoSort('starred')).toBe('starred');
    expect(parseVideoSort('curated')).toBe('curated');
  });

  it('falls back to "newest" by default for unknown / null / empty', () => {
    expect(parseVideoSort(null)).toBe('newest');
    expect(parseVideoSort(undefined)).toBe('newest');
    expect(parseVideoSort('')).toBe('newest');
    expect(parseVideoSort('made-up')).toBe('newest');
  });

  it('respects custom fallback', () => {
    expect(parseVideoSort('made-up', 'longest')).toBe('longest');
  });
});

describe('sortVideos', () => {
  const a = mk({ id: 'a', updated_at: '2026-05-01T00:00:00Z', duration_seconds: 30 });
  const b = mk({ id: 'b', updated_at: '2026-05-02T00:00:00Z', duration_seconds: 1800 });
  const c = mk({ id: 'c', updated_at: '2026-05-03T00:00:00Z', duration_seconds: 600 });

  it('newest: by updated_at desc', () => {
    expect(sortVideos([a, b, c], 'newest').map((v) => v.id)).toEqual(['c', 'b', 'a']);
  });

  it('oldest: by updated_at asc', () => {
    expect(sortVideos([a, b, c], 'oldest').map((v) => v.id)).toEqual(['a', 'b', 'c']);
  });

  it('longest: by duration_seconds desc; ties → newest', () => {
    expect(sortVideos([a, b, c], 'longest').map((v) => v.id)).toEqual(['b', 'c', 'a']);
    const tieA = mk({ id: 'tieA', updated_at: '2026-05-02T00:00:00Z', duration_seconds: 100 });
    const tieB = mk({ id: 'tieB', updated_at: '2026-05-03T00:00:00Z', duration_seconds: 100 });
    expect(sortVideos([tieA, tieB], 'longest').map((v) => v.id)).toEqual(['tieB', 'tieA']);
  });

  it('starred: starred=true rows go first; non-starred sorted by newest within group', () => {
    const star1 = mk({ id: 'star1', updated_at: '2026-05-01T00:00:00Z', starred: true });
    const star2 = mk({ id: 'star2', updated_at: '2026-05-03T00:00:00Z', starred: true });
    const plain1 = mk({ id: 'plain1', updated_at: '2026-05-02T00:00:00Z', starred: false });
    const plain2 = mk({ id: 'plain2', updated_at: '2026-05-04T00:00:00Z' });
    const r = sortVideos([star1, plain1, plain2, star2], 'starred').map((v) => v.id);
    expect(r.slice(0, 2)).toEqual(['star2', 'star1']); // both starred, by newest
    expect(r.slice(2)).toEqual(['plain2', 'plain1']); // both unstarred, by newest
  });

  it('curated: 3/3 first, then partial, then 0/3 last; ties → newest', () => {
    const full = mk({
      id: 'full',
      updated_at: '2026-05-01T00:00:00Z',
      transcript_status: 'success',
      tags: '["a"]',
      notes: 'n',
    });
    const partial = mk({
      id: 'partial',
      updated_at: '2026-05-03T00:00:00Z',
      transcript_status: 'success',
    });
    const empty = mk({ id: 'empty', updated_at: '2026-05-02T00:00:00Z' });
    const r = sortVideos([empty, partial, full], 'curated').map((v) => v.id);
    expect(r).toEqual(['full', 'partial', 'empty']);
  });

  it('returns a NEW array; does not mutate input', () => {
    const input = [a, b, c];
    const r = sortVideos(input, 'newest');
    expect(r).not.toBe(input);
    expect(input.map((v) => v.id)).toEqual(['a', 'b', 'c']); // unchanged
  });

  it('handles missing updated_at — sorts to bottom under newest, top under oldest', () => {
    const noStamp = mk({ id: 'no', updated_at: undefined });
    const recent = mk({ id: 'recent', updated_at: '2026-05-01T00:00:00Z' });
    expect(sortVideos([noStamp, recent], 'newest').map((v) => v.id)).toEqual([
      'recent',
      'no',
    ]);
    expect(sortVideos([noStamp, recent], 'oldest').map((v) => v.id)).toEqual([
      'no',
      'recent',
    ]);
  });

  it('unknown sort falls back to newest', () => {
    // sortVideos should never receive an unknown value (parseVideoSort
    // gates the API), but defensively the default is newest.
    const r = sortVideos([a, b, c], 'unknown' as never);
    expect(r.map((v) => v.id)).toEqual(['c', 'b', 'a']);
  });
});
