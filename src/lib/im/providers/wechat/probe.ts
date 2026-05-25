/**
 * WeChat Provider — Health Probe
 *
 * 用 getUpdates(empty buf, 5s timeout) 校验 token 可用：
 * 成功（ret=0）说明绑定有效，失败可能是 token 过期 / 网络异常。
 */

import type { ProbeResult } from '../../core/types';
import type { WechatClient } from './client';
import { explainWechatIlinkError } from './errors';

export async function probeWechat(client: WechatClient): Promise<ProbeResult> {
  const start = Date.now();
  const r = await client.verifyToken();
  const latencyMs = Date.now() - start;
  if (r.ok) return { ok: true, latencyMs };
  return { ok: false, latencyMs, error: explainWechatIlinkError(r.error) };
}
