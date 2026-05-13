/**
 * Server-side overview loader. Reads the local sync mirror (millisecond
 * latency) and feeds it into `computeOverview`. The expensive sqlcipher
 * pipeline lives behind the sync engine — this file never spawns python.
 */

import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { hasRecoveredKey } from '@/lib/wechat-export/setup-state';

import { computeOverview } from './overview-compute';
import { getSyncState, querySnapshot } from './mirror-store';
import { getWeChatAssistantSettings } from './settings-store';
import type { OverviewResponse } from './overview-types';

export async function loadWeChatOverview(): Promise<OverviewResponse> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    return { ready: false, reason: 'unsupported_platform' };
  }
  if (!hasValidConsent()) return { ready: false, reason: 'consent_required' };
  if (!hasRecoveredKey()) return { ready: false, reason: 'no_key' };

  const state = getSyncState();
  if (state.cursorTs === 0) {
    return { ready: false, reason: 'no_sync_yet' };
  }

  const settings = getWeChatAssistantSettings();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  const snapshot = querySnapshot(settings.ai.windowDays, nowSec);
  const data = computeOverview(snapshot, {
    windowDays: settings.ai.windowDays,
    excludedIds: settings.excludedPersonIds,
    nowMs,
  });
  return { ready: true, data };
}
