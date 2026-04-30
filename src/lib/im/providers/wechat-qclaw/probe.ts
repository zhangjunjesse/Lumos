/**
 * WeChat (QClaw) Provider — Health Probe
 */

import type { ProbeResult } from '../../core/types';
import type { QClawClient } from './client';

export async function probeQClaw(client: QClawClient): Promise<ProbeResult> {
  const start = Date.now();
  const result = await client.probeHealth();
  const latencyMs = Date.now() - start;
  if (result.ok) return { ok: true, latencyMs };
  return { ok: false, latencyMs, error: result.error };
}
