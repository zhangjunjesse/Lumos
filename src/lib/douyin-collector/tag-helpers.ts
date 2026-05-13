import { parseVideoTags } from './parsers';

/**
 * Append `tag` to a comma-separated tag string. Returns the input
 * unchanged when:
 *   - the tag is empty / whitespace
 *   - the tag (case-insensitive) is already present
 *
 * Output uses the canonical `, ` separator and preserves the original
 * casing of pre-existing tags. Pure function — used by OrganizeTab's
 * suggestion strip and re-usable anywhere tags are edited as text.
 */
export function appendTag(currentRaw: string, tag: string): string {
  const t = tag.trim();
  if (!t) return currentRaw;
  const list = parseVideoTags(currentRaw);
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return currentRaw;
  return [...list, t].join(', ');
}
