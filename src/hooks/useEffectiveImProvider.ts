'use client';

import { useEffect, useState } from 'react';

interface DefaultResponse {
  provider: string | null;
  effective: string | null;
}

const POLL_INTERVAL_MS = 10_000;

/**
 * Returns the IM provider id that the UI should treat as "the one currently
 * active" — explicit default, falling back to the first enabled provider.
 *
 * Polls /api/im/default every 10s so that a settings change in another tab
 * (or via the API) propagates to the chat header without a full reload.
 *
 * Returns null when no IM is configured or while loading.
 */
export function useEffectiveImProvider(): string | null {
  const [provider, setProvider] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/im/default', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as DefaultResponse;
        if (!cancelled) setProvider(data.effective ?? null);
      } catch {
        // best effort
      }
    };
    void tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return provider;
}
