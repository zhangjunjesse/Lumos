/**
 * One-time cleanup of chat data that older builds persisted into localStorage.
 *
 * `lumos-messages-store` and `lumos-streaming-store` used to be zustand persist
 * stores; on busy installs they grew to tens/hundreds of MB, which (a) tripped
 * QuotaExceededError on every subsequent setItem — blocking all localStorage
 * writes for the origin (#25) — and (b) OOM-crashed the renderer when the data
 * was read back and deserialized on startup (#26). Persistence has since been
 * removed, so those keys are now orphaned dead weight: drop them to reclaim the
 * quota for legitimate small writes.
 *
 * `etsy-erank-chat-model` only ever legitimately holds a short model id, but the
 * #26 diagnosis measured it at ~53MB on one install; guard against an oversized
 * value by dropping it past a threshold no legitimate value comes close to.
 */

const ORPHANED_KEYS = ['lumos-messages-store', 'lumos-streaming-store'] as const;
const SIZE_GUARDED_KEYS = ['etsy-erank-chat-model'] as const;

// No legitimate value for the guarded keys is anywhere near this large.
const OVERSIZED_THRESHOLD_CHARS = 512 * 1024; // ~512KB

export function purgeLegacyChatStorage(): void {
  if (typeof window === 'undefined') return;

  for (const key of ORPHANED_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // A failed cleanup must never break app startup.
    }
  }

  for (const key of SIZE_GUARDED_KEYS) {
    try {
      const value = window.localStorage.getItem(key);
      if (value && value.length > OVERSIZED_THRESHOLD_CHARS) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore.
    }
  }
}
