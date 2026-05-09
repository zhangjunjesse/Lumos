/**
 * Process-local keyed mutex for serializing async work that must not interleave.
 *
 * Use case: a "scan + write" pipeline where two concurrent triggers (e.g.
 * scheduled cron + manual API call) would otherwise both pass a "is the
 * quota / cooldown still OK?" check before either commits its write,
 * letting the second trigger sneak past the limit.
 *
 * Semantics:
 *   - All `withLock(key, fn)` calls sharing the same `key` run strictly in
 *     submission order.
 *   - Different keys are independent and may run concurrently.
 *   - The lock entry is released the moment `fn` settles (success or throw),
 *     and the queue cleans up automatically when no one is waiting.
 *
 * Caveats: this is a **process-local** lock. It does not coordinate across
 * Electron main/renderer, multiple Node processes, or worker threads. For
 * the Lumos desktop app (single Node main process per user) that's the
 * boundary at which races actually happen, so a JS Map is enough.
 *
 * If we ever need cross-process coordination, swap the in-memory Map for an
 * SQLite advisory lock (`PRAGMA application_id` + `BEGIN IMMEDIATE`) without
 * changing this signature.
 */

const tails = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previousTail = tails.get(key);

  // Build a placeholder promise that resolves once `fn` settles. We install
  // it as the new tail BEFORE awaiting `previousTail` so a third caller
  // arriving while we're queued sees us as the predecessor, not bypasses us.
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ourTail = previousTail
    ? previousTail.then(() => blocker, () => blocker)
    : blocker;
  tails.set(key, ourTail);

  try {
    if (previousTail) {
      // Swallow predecessor errors: we don't want one caller's failure to
      // cascade into ours. Each caller's `fn` gets its own try/catch via
      // the outer Promise chain.
      await previousTail.catch(() => undefined);
    }
    return await fn();
  } finally {
    release();
    // Only delete the tail entry if we're still the latest writer. A newer
    // caller may have replaced us — leave their tail intact.
    if (tails.get(key) === ourTail) {
      tails.delete(key);
    }
  }
}

/** Test-only — drops every queued tail. Do NOT call in production. */
export function __resetAllLocksForTesting(): void {
  tails.clear();
}
