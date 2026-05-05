/**
 * Auto-sync scheduler for the goofish local archive.
 *
 * Lazy-initialized on the first goofish API call (mirrors the pattern used
 * by `src/lib/scheduler/cron-engine.ts`). Runs in the Next.js server
 * process, ticks every 5 minutes:
 *
 *   - if no one is logged in → skip silently
 *   - if a sync is already in flight → skip (mutex)
 *   - if last successful sync was within MIN_INTERVAL → skip
 *   - otherwise fire `runSync({ since: lastSync - 1h })` (incremental)
 *
 * Errors are swallowed and logged. The UI / MCP search still works against
 * whatever's currently in the archive when sync is failing.
 */

import { runSyncAllAccounts, getLastSyncMs } from './sync';
import { getSyncIntervalMs } from './db';
import { listAccounts } from './accounts';
import { getGoofishMcpEnabled, setGoofishMcpEnabled } from './mcp-toggle';

// Wake up every 15s to check; sync happens only when configured interval has
// elapsed since the last successful sync. This way changing the interval via
// settings takes effect by the next wake (no scheduler restart needed).
const TICK_INTERVAL_MS = 15_000;
const SINCE_LOOKBACK_MS = 60 * 60_000;        // re-enrich sessions active in last hour

let initialized = false;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

export function initGoofishSyncScheduler(): void {
  if (initialized) return;
  initialized = true;
  // Defer the first tick a bit so server startup isn't bogged down.
  setTimeout(() => { void tick(); }, 10_000);
  timer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
}

function ensureMcpEnabledIfAccountsExist(): void {
  try {
    const accounts = listAccounts().filter((a) => a.hasCookies);
    if (accounts.length === 0) return;
    if (getGoofishMcpEnabled() === false) {
      setGoofishMcpEnabled(true);
      console.log('[goofish-sync] enabled goofish MCP (account exists)');
    }
  } catch { /* best effort */ }
}

export function stopGoofishSyncScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  initialized = false;
}

async function tick(): Promise<void> {
  // Self-heal MCP enable state every tick (cheap DB lookups). Without this,
  // a logged-in account whose MCP got disabled (e.g. by a stale toggle or a
  // fresh init-builtin-resources) stays invisible to the AI until the user
  // opens the goofish panel.
  ensureMcpEnabledIfAccountsExist();

  if (inFlight) return;
  const lastMs = getLastSyncMs();
  const intervalMs = getSyncIntervalMs();
  const now = Date.now();
  if (lastMs && now - lastMs < intervalMs) return;

  inFlight = true;
  try {
    const since = lastMs ? Math.max(0, lastMs - SINCE_LOOKBACK_MS) : 0;
    const results = await runSyncAllAccounts({ since });
    const okCount = results.filter((r) => r.ok).length;
    const totalMsgs = results.reduce((s, r) => s + r.messagesUpserted, 0);
    if (results.length === 0) return;  // no accounts configured
    if (okCount > 0) {
      console.log(`[goofish-sync] ${okCount}/${results.length} accounts synced, ${totalMsgs} new messages`);
    }
  } catch (err) {
    console.warn('[goofish-sync] tick crashed:', err);
  } finally {
    inFlight = false;
  }
}
