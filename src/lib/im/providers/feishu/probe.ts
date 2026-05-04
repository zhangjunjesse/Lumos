/**
 * Feishu Provider — Health Probe
 *
 * Settings UI 的"测试连接"按钮调到这里。
 * 拉一次 tenant_access_token 验证 appId/appSecret 可用。
 */

import type { ProbeResult } from '../../core/types';
import type { FeishuClient } from './client';

export async function probeFeishu(client: FeishuClient): Promise<ProbeResult> {
  const start = Date.now();
  const result = await client.probeCredentials();
  const latencyMs = Date.now() - start;
  if (result.ok) return { ok: true, latencyMs };
  return { ok: false, latencyMs, error: result.error };
}
