'use client';

import { useEffect } from 'react';
import { purgeLegacyChatStorage } from '@/lib/storage/legacy-chat-storage';

/**
 * Runs the one-time legacy localStorage cleanup once on mount. Renders nothing.
 * Mounted high in the root layout so the quota is reclaimed before chat views
 * (and other localStorage writers) run. See #25/#26.
 */
export function LegacyStoragePurge(): null {
  useEffect(() => {
    purgeLegacyChatStorage();
  }, []);

  return null;
}
