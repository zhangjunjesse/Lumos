import { countActiveFilters } from '../library-filter-helpers';

const DEFAULT = {
  status: 'all',
  search: '',
  tag: '',
  backlog: null,
  creatorRef: '',
  searchScope: 'metadata',
};

describe('countActiveFilters', () => {
  it('returns 0 for default filter snapshot', () => {
    expect(countActiveFilters(DEFAULT)).toBe(0);
  });

  it('counts each filter dimension independently', () => {
    expect(countActiveFilters({ ...DEFAULT, status: 'unprocessed' })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT, search: 'ai' })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT, tag: 'prompt' })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT, backlog: 'starred' })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT, creatorRef: 'sec-uid-123' })).toBe(1);
  });

  it('whitespace-only strings do not count as active', () => {
    expect(countActiveFilters({ ...DEFAULT, search: '   ' })).toBe(0);
    expect(countActiveFilters({ ...DEFAULT, tag: '\t' })).toBe(0);
    expect(countActiveFilters({ ...DEFAULT, creatorRef: ' ' })).toBe(0);
  });

  it('searchScope=transcript only counts when search is also set', () => {
    // Toggle alone: a UI default that does nothing without a query
    expect(
      countActiveFilters({ ...DEFAULT, searchScope: 'transcript' }),
    ).toBe(0);
    // Toggle + query: 2 dimensions active (search + scope)
    expect(
      countActiveFilters({ ...DEFAULT, searchScope: 'transcript', search: 'ai' }),
    ).toBe(2);
  });

  it('stacks correctly when multiple dimensions are active', () => {
    expect(
      countActiveFilters({
        status: 'unprocessed',
        search: 'kv cache',
        tag: 'prompt',
        backlog: 'transcribePending',
        creatorRef: 'sec-1',
        searchScope: 'transcript',
      }),
    ).toBe(6); // status + search + tag + backlog + creator + scope
  });

  it('status=all is the default; not counted', () => {
    expect(countActiveFilters({ ...DEFAULT, status: 'all' })).toBe(0);
    expect(countActiveFilters({ ...DEFAULT, status: 'discarded' })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT, status: 'published' })).toBe(1);
  });
});
