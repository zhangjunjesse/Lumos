// 共享 LLM 调用层 — Anthropic-compatible /v1/messages
//
// Pinterest 选品、Etsy 选品、其他需要"按 Lumos 默认 provider 调 LLM 出文本"的应用都用这里。
// 不重复造 loadProvider / callLLM,所有 provider 解析逻辑收口在此。
//
// 不在这里:
//   - 流式输出(应用层不需要,串行调用即可)
//   - 工具调用(那走 Claude Agent SDK)
//   - 多轮对话(应用层自己组装 messages 数组)

import { getDefaultProvider, getProvider } from '../db/providers';
import { providerSupportsCapability } from '../provider-config';
import { resolveProviderRequestApiKey, resolveAnthropicSdkBaseUrl } from '../provider-model-discovery';
import { resolveProviderModelForRequest } from '../model-metadata';
import type { ApiProvider } from '@/types';

export interface TextGenProviderHandle {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerId: string;
  providerName: string;
}

export interface LoadTextGenProviderOptions {
  /** 显式指定 provider id;否则用 default */
  providerId?: string;
  /** 显式指定 model;否则按 catalog 偏好 sonnet > opus > haiku 选 */
  model?: string;
}

function pickModelId(provider: ApiProvider): string {
  try {
    const list = JSON.parse(provider.model_catalog || '[]') as Array<{ value: string }>;
    const ids = list.map((x) => x.value).filter(Boolean);
    const pref = ids.find((x) => /sonnet/i.test(x))
      ?? ids.find((x) => /opus/i.test(x))
      ?? ids.find((x) => /haiku/i.test(x))
      ?? ids[0] ?? '';
    if (pref) return resolveProviderModelForRequest(provider, pref) || pref;
  } catch { /* ignore */ }
  return resolveProviderModelForRequest(provider, '') || '';
}

/**
 * 解析 Lumos 默认 / 指定的 text-gen provider,返回可直接 HTTP 调用的 handle。
 *
 * 校验链:
 *   1. provider 存在
 *   2. 支持 text-gen capability
 *   3. 非 local_auth(local_auth 是 Claude Agent SDK 专用,不能 plain HTTP)
 *   4. 有可用 api_key
 *   5. 有可用 base_url
 *   6. 有可用 model
 */
export function loadTextGenProvider(opts: LoadTextGenProviderOptions = {}): TextGenProviderHandle {
  let provider: ApiProvider | undefined;
  if (opts.providerId) {
    provider = getProvider(opts.providerId);
    if (!provider) throw new Error(`Provider 「${opts.providerId}」不存在`);
  } else {
    provider = getDefaultProvider();
    if (!provider) {
      throw new Error('未设置默认 Provider — 请在 Lumos 设置 → 服务商 里选一个"当前使用"');
    }
  }
  if (!providerSupportsCapability(provider, 'text-gen')) {
    throw new Error(`Provider 「${provider.name}」不支持文本生成(text-gen)。请换一个支持 text-gen 的 provider。`);
  }
  if (provider.auth_mode === 'local_auth') {
    throw new Error(`Provider 「${provider.name}」用 local_auth(Claude Agent SDK 专用),不能直接 HTTP 调用。`);
  }
  const apiKey = resolveProviderRequestApiKey(provider);
  if (!apiKey) {
    throw new Error(`Provider 「${provider.name}」未配置可用的 API Key`);
  }
  const baseUrl = (resolveAnthropicSdkBaseUrl(provider) || provider.base_url || '').replace(/\/v1\/?$/, '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error(`Provider 「${provider.name}」缺少 base_url`);
  }
  const model = opts.model
    ? (resolveProviderModelForRequest(provider, opts.model) || opts.model)
    : pickModelId(provider);
  if (!model) {
    throw new Error(`Provider 「${provider.name}」无可用 model`);
  }
  return { baseUrl, apiKey, model, providerId: provider.id, providerName: provider.name };
}

export interface CallTextGenOptions {
  system: string;
  userPrompt: string;
  maxTokens?: number;
}

/** 调 Anthropic-compatible /v1/messages,返回拼好的纯文本。 */
export async function callTextGen(
  provider: TextGenProviderHandle,
  opts: CallTextGenOptions,
): Promise<string> {
  const res = await fetch(`${provider.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages: [{ role: 'user', content: opts.userPrompt }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  if (!text) throw new Error('LLM 空响应');
  return text;
}

/** 给 health UI 看 — 不抛错,返回当前选的 provider + 校验结果 */
export function describeTextGenProvider(): {
  providerId?: string;
  providerName?: string;
  baseUrl?: string;
  model?: string;
  ok: boolean;
  error?: string;
} {
  try {
    const p = loadTextGenProvider();
    return { providerId: p.providerId, providerName: p.providerName, baseUrl: p.baseUrl, model: p.model, ok: true };
  } catch (err) {
    const provider = getDefaultProvider();
    return {
      providerId: provider?.id,
      providerName: provider?.name,
      baseUrl: provider?.base_url,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
