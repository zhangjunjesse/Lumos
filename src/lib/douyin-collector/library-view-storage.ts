/**
 * Schema-validated serializer for the Library tab's filter view. Persists
 * to localStorage so a returning user lands on the same filter combo
 * they left. Round 93's "重置全部 (N)" button gives them a single-click
 * escape hatch when the restored state isn't what they want.
 *
 * Pure helpers here are testable without standing up React or a DOM.
 */

const ALLOWED_STATUS = ['all', 'unprocessed', 'draft', 'published', 'discarded'] as const;
const ALLOWED_SORT = ['newest', 'oldest', 'longest', 'starred', 'curated'] as const;
const ALLOWED_BACKLOG = [
  'transcribePending',
  'transcribeFailed',
  'publishReady',
  'recent7d',
  'starred',
] as const;
const ALLOWED_SEARCH_SCOPE = ['metadata', 'transcript'] as const;

export interface LibraryViewSnapshot {
  status: (typeof ALLOWED_STATUS)[number];
  search: string;
  tag: string;
  sort: (typeof ALLOWED_SORT)[number];
  backlog: (typeof ALLOWED_BACKLOG)[number] | null;
  searchScope: (typeof ALLOWED_SEARCH_SCOPE)[number];
  creatorRef: string;
  creatorLabel: string;
}

export const DEFAULT_VIEW: LibraryViewSnapshot = {
  status: 'all',
  search: '',
  tag: '',
  sort: 'newest',
  backlog: null,
  searchScope: 'metadata',
  creatorRef: '',
  creatorLabel: '',
};

/**
 * Strict deserializer. Anything malformed or out-of-enum falls back to
 * the default value for that field — never throws. This keeps the user
 * out of a "broken UI" state if localStorage gets corrupted across
 * versions.
 */
export function deserializeView(raw: string | null | undefined): LibraryViewSnapshot {
  if (!raw) return { ...DEFAULT_VIEW };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_VIEW };
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_VIEW };
  const obj = parsed as Record<string, unknown>;

  const status = (ALLOWED_STATUS as readonly string[]).includes(obj.status as string)
    ? (obj.status as LibraryViewSnapshot['status'])
    : DEFAULT_VIEW.status;
  const sort = (ALLOWED_SORT as readonly string[]).includes(obj.sort as string)
    ? (obj.sort as LibraryViewSnapshot['sort'])
    : DEFAULT_VIEW.sort;
  const backlog =
    obj.backlog === null
      ? null
      : (ALLOWED_BACKLOG as readonly string[]).includes(obj.backlog as string)
        ? (obj.backlog as LibraryViewSnapshot['backlog'])
        : DEFAULT_VIEW.backlog;
  const searchScope = (ALLOWED_SEARCH_SCOPE as readonly string[]).includes(
    obj.searchScope as string,
  )
    ? (obj.searchScope as LibraryViewSnapshot['searchScope'])
    : DEFAULT_VIEW.searchScope;
  const search = typeof obj.search === 'string' ? obj.search : DEFAULT_VIEW.search;
  const tag = typeof obj.tag === 'string' ? obj.tag : DEFAULT_VIEW.tag;
  const creatorRef = typeof obj.creatorRef === 'string' ? obj.creatorRef : DEFAULT_VIEW.creatorRef;
  const creatorLabel =
    typeof obj.creatorLabel === 'string' ? obj.creatorLabel : DEFAULT_VIEW.creatorLabel;

  return { status, sort, backlog, searchScope, search, tag, creatorRef, creatorLabel };
}

export function serializeView(snap: LibraryViewSnapshot): string {
  return JSON.stringify(snap);
}

/**
 * True when the view is meaningfully different from the default — used
 * by the UI to decide whether to render the "已恢复上次筛选" hint.
 * Sort isn't counted; it's a preference, not a filter.
 */
export function isMeaningfulView(snap: LibraryViewSnapshot): boolean {
  return (
    snap.status !== DEFAULT_VIEW.status ||
    snap.search.trim().length > 0 ||
    snap.tag.trim().length > 0 ||
    snap.backlog !== null ||
    snap.searchScope !== DEFAULT_VIEW.searchScope ||
    snap.creatorRef.trim().length > 0
  );
}
