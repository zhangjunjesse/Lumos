/**
 * Window-level custom events for cross-component invalidation. Avoids
 * threading a refresh prop through every parent ↔ child seam when a
 * mutation in one panel should reflect in another.
 *
 * Events are best-effort: if SSR or a non-browser context, no-op.
 */

export const DOUYIN_TAGS_CHANGED = 'lumos:douyin-collector:tags-changed';

export function emitTagsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DOUYIN_TAGS_CHANGED));
}
