/**
 * WeChat Work Provider — Health Probe
 */

import type { ProbeResult } from '../../core/types';
import type { WechatWorkClient } from './client';

export async function probeWechatWork(client: WechatWorkClient): Promise<ProbeResult> {
  const start = Date.now();
  const result = await client.probeCredentials();
  const latencyMs = Date.now() - start;
  return result.ok ? { ok: true, latencyMs } : { ok: false, latencyMs, error: result.error };
}
