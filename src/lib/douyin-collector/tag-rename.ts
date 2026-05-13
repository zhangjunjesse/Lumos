import { parseVideoTags } from './parsers';

export interface TagRenameInput {
  id: string;
  tags?: string | null;
}

export interface TagRenamePatch {
  id: string;
  /** Updated tags as a JSON string ready to write back. */
  nextTagsJson: string;
  /** True when this row's tag list actually changed. */
  changed: boolean;
}

/**
 * Compute per-video patches that rename `from` to `to` in the tag list,
 * preserving order and de-duplicating case-insensitively. Pure function
 * so callers can dry-run before writing or skip the DB call entirely
 * when no row would change.
 *
 * Honest contract:
 *   - Match is case-insensitive: `AI` and `ai` and `Ai` all rename to `to`.
 *   - When `to` already exists in the row, dropping `from` collapses the
 *     duplicate (so `["AI","Ai"] → "ai" → ["ai"]`, not `["ai","ai"]`).
 *   - `from === to` (case-insensitive) is treated as identity — no
 *     patches; useful for the API layer to short-circuit.
 *   - Empty `to` removes `from` from all tag lists (effectively a tag
 *     deletion). Caller's choice whether to expose that as a UX.
 *
 * Order is preserved: the index of the first occurrence of `from` is
 * where `to` lands (unless `to` was already present earlier).
 */
export function computeTagRenamePatches(
  videos: TagRenameInput[],
  from: string,
  to: string,
): TagRenamePatch[] {
  const fromKey = from.trim().toLowerCase();
  const toClean = to.trim();
  if (!fromKey) return [];
  if (fromKey === toClean.toLowerCase()) return []; // no-op rename

  const patches: TagRenamePatch[] = [];
  for (const v of videos) {
    const list = parseVideoTags(v.tags);
    if (list.length === 0) continue;

    const seen = new Set<string>();
    const next: string[] = [];
    let changed = false;
    for (const t of list) {
      const tKey = t.toLowerCase();
      if (tKey === fromKey) {
        changed = true;
        if (!toClean) continue; // empty `to` = delete
        const toKey = toClean.toLowerCase();
        if (seen.has(toKey)) continue; // already added a renamed instance
        seen.add(toKey);
        next.push(toClean);
      } else {
        if (seen.has(tKey)) continue; // pre-existing duplicate, skip
        seen.add(tKey);
        next.push(t);
      }
    }
    if (changed) {
      patches.push({ id: v.id, nextTagsJson: JSON.stringify(next), changed: true });
    }
  }
  return patches;
}
