import { computeCurationCompleteness } from './curation';

export const VIDEO_SORTS = ['newest', 'oldest', 'longest', 'starred', 'curated'] as const;
export type VideoSort = (typeof VIDEO_SORTS)[number];

export interface SortableVideo {
  updated_at?: string;
  duration_seconds?: number;
  starred?: boolean;
  transcript_status?: string;
  tags?: string | null;
  notes?: string | null;
}

/**
 * Sort the videos collection per user-selected mode. Pure function with
 * a stable secondary sort by `updated_at` desc — keeps row order
 * deterministic when the primary key ties.
 *
 * Honest contract:
 *   - 'newest' / 'oldest': by `updated_at`, lexicographic on ISO strings.
 *     Falls back to empty string for missing values (sorts to the bottom
 *     under newest, top under oldest).
 *   - 'longest': by `duration_seconds` desc; ties → newest.
 *   - 'starred': starred=true first, then newest within each group.
 *   - 'curated': curation score (字幕/标签/备注 3 项满分) desc, then
 *     newest within each score level — surfaces "fully integrated" videos.
 *
 * Always returns a NEW array; never mutates input.
 */
export function sortVideos<T extends SortableVideo>(items: T[], sort: VideoSort): T[] {
  const out = [...items];
  const cmpNewest = (a: T, b: T) =>
    (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
  const cmpOldest = (a: T, b: T) =>
    (a.updated_at ?? '').localeCompare(b.updated_at ?? '');

  switch (sort) {
    case 'oldest':
      out.sort(cmpOldest);
      return out;
    case 'longest':
      out.sort((a, b) => {
        const diff = (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0);
        return diff !== 0 ? diff : cmpNewest(a, b);
      });
      return out;
    case 'starred':
      out.sort((a, b) => {
        const diff = (b.starred === true ? 1 : 0) - (a.starred === true ? 1 : 0);
        return diff !== 0 ? diff : cmpNewest(a, b);
      });
      return out;
    case 'curated': {
      const score = (v: T) =>
        computeCurationCompleteness({
          transcript_status: v.transcript_status,
          tags: v.tags,
          notes: v.notes,
        }).score;
      out.sort((a, b) => {
        const diff = score(b) - score(a);
        return diff !== 0 ? diff : cmpNewest(a, b);
      });
      return out;
    }
    case 'newest':
    default:
      out.sort(cmpNewest);
      return out;
  }
}

/**
 * Loose validator: returns the typed sort if the raw string is allowed,
 * else a default. Used at the API boundary.
 */
export function parseVideoSort(raw: string | null | undefined, fallback: VideoSort = 'newest'): VideoSort {
  if (raw && (VIDEO_SORTS as readonly string[]).includes(raw)) {
    return raw as VideoSort;
  }
  return fallback;
}
