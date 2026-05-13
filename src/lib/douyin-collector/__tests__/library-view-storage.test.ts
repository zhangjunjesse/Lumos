import {
  DEFAULT_VIEW,
  deserializeView,
  isMeaningfulView,
  serializeView,
} from '../library-view-storage';

describe('deserializeView', () => {
  it('returns DEFAULT_VIEW when input is null / undefined / empty', () => {
    expect(deserializeView(null)).toEqual(DEFAULT_VIEW);
    expect(deserializeView(undefined)).toEqual(DEFAULT_VIEW);
    expect(deserializeView('')).toEqual(DEFAULT_VIEW);
  });

  it('returns DEFAULT_VIEW when JSON is malformed', () => {
    expect(deserializeView('{not-json')).toEqual(DEFAULT_VIEW);
    expect(deserializeView('null')).toEqual(DEFAULT_VIEW);
    expect(deserializeView('[]')).toEqual(DEFAULT_VIEW);
  });

  it('round-trips a legitimate snapshot', () => {
    const snap = {
      status: 'unprocessed' as const,
      search: 'kv cache',
      tag: 'ai',
      sort: 'longest' as const,
      backlog: 'publishReady' as const,
      searchScope: 'transcript' as const,
      creatorRef: 'sec-uid-abc',
      creatorLabel: '王垠',
    };
    expect(deserializeView(serializeView(snap))).toEqual(snap);
  });

  it('falls back per-field when an enum is out of range — no throws', () => {
    const raw = JSON.stringify({
      status: 'invalid-status',
      sort: 'random',
      backlog: 'fakeBacklog',
      searchScope: 'wrong',
      search: 'kept',
      tag: 'kept-tag',
      creatorRef: 'kept-ref',
      creatorLabel: 'kept-label',
    });
    const r = deserializeView(raw);
    expect(r.status).toBe(DEFAULT_VIEW.status);
    expect(r.sort).toBe(DEFAULT_VIEW.sort);
    expect(r.backlog).toBe(DEFAULT_VIEW.backlog);
    expect(r.searchScope).toBe(DEFAULT_VIEW.searchScope);
    // Free-text fields are preserved
    expect(r.search).toBe('kept');
    expect(r.tag).toBe('kept-tag');
    expect(r.creatorRef).toBe('kept-ref');
    expect(r.creatorLabel).toBe('kept-label');
  });

  it('explicit backlog=null is preserved (it is a valid value, not a default fallback)', () => {
    const raw = JSON.stringify({ ...DEFAULT_VIEW, backlog: null, status: 'discarded' });
    expect(deserializeView(raw).backlog).toBeNull();
    expect(deserializeView(raw).status).toBe('discarded');
  });

  it('non-string free-text falls back to default', () => {
    const raw = JSON.stringify({ ...DEFAULT_VIEW, search: 42, tag: { not: 'string' } });
    const r = deserializeView(raw);
    expect(r.search).toBe('');
    expect(r.tag).toBe('');
  });
});

describe('isMeaningfulView', () => {
  it('returns false for the default view', () => {
    expect(isMeaningfulView(DEFAULT_VIEW)).toBe(false);
  });

  it('returns true for any non-default filter dimension', () => {
    expect(isMeaningfulView({ ...DEFAULT_VIEW, status: 'unprocessed' })).toBe(true);
    expect(isMeaningfulView({ ...DEFAULT_VIEW, search: 'ai' })).toBe(true);
    expect(isMeaningfulView({ ...DEFAULT_VIEW, tag: 'cache' })).toBe(true);
    expect(isMeaningfulView({ ...DEFAULT_VIEW, backlog: 'starred' })).toBe(true);
    expect(isMeaningfulView({ ...DEFAULT_VIEW, searchScope: 'transcript' })).toBe(true);
    expect(isMeaningfulView({ ...DEFAULT_VIEW, creatorRef: 'sec-1' })).toBe(true);
  });

  it('whitespace-only free-text does not count as meaningful', () => {
    expect(isMeaningfulView({ ...DEFAULT_VIEW, search: '   ' })).toBe(false);
    expect(isMeaningfulView({ ...DEFAULT_VIEW, tag: '\t' })).toBe(false);
    expect(isMeaningfulView({ ...DEFAULT_VIEW, creatorRef: ' ' })).toBe(false);
  });

  it('sort change alone does NOT count as meaningful (preference, not filter)', () => {
    expect(isMeaningfulView({ ...DEFAULT_VIEW, sort: 'longest' })).toBe(false);
  });
});
