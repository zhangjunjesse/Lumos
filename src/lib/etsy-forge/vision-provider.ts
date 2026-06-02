// 识图(图片分类 / 二创拆解 / 二创质检)用的服务商 + 模型解析。
// 优先用设置里指定的 vision_provider_id + vision_model;没指定 → 回退图片服务商的 chat 端点 + 默认 gemini。
// 三处识图统一走这里,改一个地方全生效。返回可直接打 /v1/chat/completions 的 baseUrl/apiKey/model。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { isChatProviderLocked } from './provider-options';
import { COLLECTIONS } from './types';

export const DEFAULT_VISION_MODEL = 'gemini-2.5-flash-official';

export type VisionProtocol = 'openai' | 'anthropic';

export interface VisionEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: VisionProtocol; // 决定打 /v1/chat/completions 还是 /v1/messages
}

// anthropic-messages 协议 → anthropic;其余(openai-compatible 等)→ openai。
function protocolOf(apiProtocol?: string | null): VisionProtocol {
  return apiProtocol === 'anthropic-messages' ? 'anthropic' : 'openai';
}

export function resolveVisionEndpoint(store: AppDataStore): { ok: true; ep: VisionEndpoint } | { ok: false; error: string } {
  const s = store.query<{ vision_provider_id?: string; vision_model?: string }>(COLLECTIONS.APP_SETTINGS, { limit: 1 })[0];
  const prefId = s?.vision_provider_id?.trim();

  // 指定了识图服务商:用它(锁定版走 agent-chat 强制 system origin,否则 text-gen 任意)。
  if (prefId) {
    const p = resolveProviderForCapability({
      moduleKey: 'chat',
      capability: isChatProviderLocked() ? 'agent-chat' : 'text-gen',
      preferredProviderId: prefId,
    });
    if (p && p.auth_mode !== 'local_auth') {
      const baseUrl = (p.base_url || '').replace(/\/+$/, '');
      const apiKey = p.api_key || '';
      if (baseUrl && apiKey) {
        return { ok: true, ep: { baseUrl, apiKey, model: s?.vision_model?.trim() || DEFAULT_VISION_MODEL, protocol: protocolOf(p.api_protocol) } };
      }
    }
  }

  // 回退:图片服务商的 chat 端点 + 默认视觉模型。
  const img = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!img) return { ok: false, error: '未配置识图服务商,也没有图片服务商兜底(去「设置」选)' };
  const baseUrl = (img.base_url || '').replace(/\/+$/, '');
  const apiKey = img.api_key || '';
  if (!baseUrl || !apiKey) return { ok: false, error: '识图服务商缺 base_url 或 api_key' };
  return { ok: true, ep: { baseUrl, apiKey, model: DEFAULT_VISION_MODEL, protocol: protocolOf(img.api_protocol) } };
}
