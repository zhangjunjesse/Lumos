'use client';

import * as React from 'react';

/**
 * Cmd/Ctrl+K focuses the library search input. Esc clears it when the
 * search input is the active element. Skips when other modifiers
 * (Shift/Alt) are pressed so we don't steal hotkeys from textareas.
 *
 * Extracted from LibraryTab in round 14.
 */
export function useLibrarySearchShortcut(
  searchInputRef: React.RefObject<HTMLInputElement | null>,
  searchInput: string,
  setSearchInput: (value: string) => void,
): void {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (
        e.key === 'Escape' &&
        document.activeElement === searchInputRef.current &&
        searchInput.length > 0
      ) {
        e.preventDefault();
        setSearchInput('');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [searchInputRef, searchInput, setSearchInput]);
}
