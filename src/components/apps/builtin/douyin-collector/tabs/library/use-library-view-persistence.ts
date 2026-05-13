'use client';

import * as React from 'react';

import {
  serializeView,
  type LibraryViewSnapshot,
} from '@/lib/douyin-collector/library-view-storage';

/**
 * Persist the user's library filter state to localStorage on every change
 * so they land back on the same view after refresh / app restart.
 *
 * Search debounce upstream already throttles per-keystroke writes; other
 * state changes are coarse enough to write immediately.
 *
 * Extracted from LibraryTab in round 14.
 */
export function useLibraryViewPersistence(
  storageKey: string,
  view: LibraryViewSnapshot,
): void {
  // Stable string captures so the effect doesn't write on every render.
  const serialized = serializeView(view);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, serialized);
    } catch {
      /* localStorage may be unavailable in some incognito modes — silent */
    }
  }, [storageKey, serialized]);
}
