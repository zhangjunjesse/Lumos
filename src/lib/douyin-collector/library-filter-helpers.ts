/**
 * Tally how many filter dimensions are non-default in the Library view.
 * Pure function — used by LibraryTab to decide whether to render the
 * "重置全部" link, and by tests to assert the count without standing up
 * React.
 *
 * Counted dimensions:
 *   - status: anything except 'all'
 *   - search: any non-empty string
 *   - tag: any non-empty string
 *   - backlog: any chip selected
 *   - creatorRef: any non-empty string
 *   - searchScope='transcript': only when search is also set (otherwise
 *     it's just a default that does nothing visible)
 *
 * NOT counted (orthogonal to "filtering"):
 *   - sort: changes ordering, not membership
 */
export interface LibraryFilterSnapshot {
  status: string;
  search: string;
  tag: string;
  backlog: string | null;
  creatorRef: string;
  searchScope: string;
}

export function countActiveFilters(snap: LibraryFilterSnapshot): number {
  let n = 0;
  if (snap.status && snap.status !== 'all') n += 1;
  if (snap.search && snap.search.trim().length > 0) n += 1;
  if (snap.tag && snap.tag.trim().length > 0) n += 1;
  if (snap.backlog) n += 1;
  if (snap.creatorRef && snap.creatorRef.trim().length > 0) n += 1;
  if (snap.searchScope === 'transcript' && snap.search && snap.search.trim().length > 0) n += 1;
  return n;
}
