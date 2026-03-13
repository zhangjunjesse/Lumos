import {
  getActiveProvider,
  getAllProviders,
  getDefaultProviderId,
  getProvider,
  getSetting,
} from '@/lib/db';
import type { ApiProvider } from '@/types';
import { BUILTIN_CLAUDE_MODEL_IDS, resolveBuiltInClaudeModelId } from '@/lib/model-metadata';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const UNSUPPORTED_PROVIDER_TYPES = new Set(['gemini-image', 'bedrock', 'vertex']);

interface KnowledgeLlmRequest {
  model: string;
  maxTokens: number;
  prompt: string;
  system?: string;
  timeoutMs?: number;
  fallbackModels?: string[];
}

function pickNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function parseExtraEnv(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function readProviderKey(provider: ApiProvider): string {
  const extraEnv = parseExtraEnv(provider.extra_env);
  return pickNonEmpty(
    provider.api_key,
    extraEnv.ANTHROPIC_API_KEY,
    extraEnv.ANTHROPIC_AUTH_TOKEN,
  );
}

function readProviderBaseUrl(provider: ApiProvider): string {
  const extraEnv = parseExtraEnv(provider.extra_env);
  return pickNonEmpty(
    extraEnv.ANTHROPIC_BASE_URL,
    provider.base_url,
  );
}

function isSupportedProvider(provider: ApiProvider | undefined): provider is ApiProvider {
  if (!provider) return false;
  return !UNSUPPORTED_PROVIDER_TYPES.has(provider.provider_type);
}

function resolveProviderForKnowledge(): ApiProvider | undefined {
  const active = getActiveProvider();
  if (isSupportedProvider(active) && readProviderKey(active)) {
    return active;
  }

  const defaultProviderId = getDefaultProviderId() || '';
  if (defaultProviderId) {
    const provider = getProvider(defaultProviderId);
    if (isSupportedProvider(provider) && readProviderKey(provider)) {
      return provider;
    }
  }

  return getAllProviders().find((provider) => {
    return isSupportedProvider(provider) && Boolean(readProviderKey(provider));
  });
}

function resolveMessagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/v1/messages')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractErrorMessage(payload: unknown): string {
  const record = toRecord(payload);
  if (!record) return '';

  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim();
  }

  const errorField = record.error;
  if (typeof errorField === 'string' && errorField.trim()) {
    return errorField.trim();
  }

  const errorObject = toRecord(errorField);
  if (errorObject && typeof errorObject.message === 'string' && errorObject.message.trim()) {
    return errorObject.message.trim();
  }

  return '';
}

function extractContentText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        const block = toRecord(entry);
        if (!block) return '';
        if (typeof block.text === 'string') return block.text.trim();
        return '';
      })
      .filter((part) => Boolean(part));
    return parts.join('\n').trim();
  }

  const objectValue = toRecord(value);
  if (objectValue && typeof objectValue.text === 'string') {
    return objectValue.text.trim();
  }

  return '';
}

function extractResponseText(payload: unknown): string {
  const record = toRecord(payload);
  if (!record) return '';

  if (Array.isArray(record.content)) {
    const text = extractContentText(record.content);
    if (text) return text;
  }

  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text.trim();
  }

  if (Array.isArray(record.choices) && record.choices.length > 0) {
    const firstChoice = toRecord(record.choices[0]);
    if (!firstChoice) return '';

    const message = toRecord(firstChoice.message);
    if (message) {
      const text = extractContentText(message.content);
      if (text) return text;
    }

    const text = extractContentText(firstChoice.text);
    if (text) return text;
  }

  return '';
}

function resolveKnowledgeApiConfig(): { url: string; headers: Record<string, string> } {
  const provider = resolveProviderForKnowledge();
  const providerKey = provider ? readProviderKey(provider) : '';
  const providerBaseUrl = provider ? readProviderBaseUrl(provider) : '';

  const apiKey = pickNonEmpty(
    providerKey,
    getSetting('anthropic_api_key'),
    getSetting('anthropic_auth_token'),
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_AUTH_TOKEN,
  );
  if (!apiKey) {
    throw new Error('未配置 API Key，请在“设置 > 服务商”里配置并启用 Claude 提供商');
  }

  const baseUrl = pickNonEmpty(
    providerBaseUrl,
    getSetting('anthropic_base_url'),
    process.env.ANTHROPIC_BASE_URL,
    DEFAULT_BASE_URL,
  );
  const useBearer =
    provider?.provider_type === 'openrouter' ||
    baseUrl.includes('openrouter.ai');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (useBearer) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers['x-api-key'] = apiKey;
  }

  return {
    url: resolveMessagesUrl(baseUrl),
    headers,
  };
}

function isModelUnavailableError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    /模型|未开放|未找到模型|无可用模型|model/.test(message) &&
    (
      text.includes('not available') ||
      text.includes('not found') ||
      text.includes('unsupported') ||
      text.includes('unknown') ||
      text.includes('invalid') ||
      text.includes('unavailable') ||
      text.includes('does not exist') ||
      text.includes('未开放') ||
      text.includes('未找到') ||
      text.includes('不可用')
    )
  );
}

function resolveModelCandidates(requestedModel: string, fallbackModels?: string[]): string[] {
  const candidates = [
    requestedModel,
    ...(fallbackModels || []),
    getSetting('default_model'),
    BUILTIN_CLAUDE_MODEL_IDS.sonnet,
    BUILTIN_CLAUDE_MODEL_IDS.haiku,
  ];

  const unique: string[] = [];
  for (const model of candidates) {
    if (!model || !model.trim()) continue;
    const normalized = resolveBuiltInClaudeModelId(model.trim(), 'sonnet');
    if (unique.includes(normalized)) continue;
    unique.push(normalized);
  }
  return unique;
}

async function callKnowledgeModelOnce(params: {
  config: { url: string; headers: Record<string, string> };
  model: string;
  maxTokens: number;
  prompt: string;
  system?: string;
  timeoutMs: number;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await fetch(params.config.url, {
      method: 'POST',
      signal: controller.signal,
      headers: params.config.headers,
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens,
        ...(params.system ? { system: params.system } : {}),
        messages: [{ role: 'user', content: params.prompt }],
      }),
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const message = extractErrorMessage(payload);
    if (!response.ok) {
      throw new Error(message || `HTTP ${response.status}`);
    }
    if (message) {
      throw new Error(message);
    }

    const text = extractResponseText(payload);
    if (!text) {
      throw new Error('模型返回为空');
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function callKnowledgeModel(params: KnowledgeLlmRequest): Promise<string> {
  const config = resolveKnowledgeApiConfig();
  const timeoutMs = Number.isFinite(params.timeoutMs) ? Math.max(1000, Number(params.timeoutMs)) : 8000;
  const modelCandidates = resolveModelCandidates(params.model, params.fallbackModels);

  let lastError: Error | null = null;
  for (let i = 0; i < modelCandidates.length; i += 1) {
    const model = modelCandidates[i];
    try {
      const text = await callKnowledgeModelOnce({
        config,
        model,
        maxTokens: params.maxTokens,
        prompt: params.prompt,
        system: params.system,
        timeoutMs,
      });
      if (i > 0) {
        console.warn(`[kb] Model fallback applied: ${params.model} -> ${model}`);
      }
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = error instanceof Error ? error : new Error(message);
      const canRetry = i < modelCandidates.length - 1 && isModelUnavailableError(message);
      if (!canRetry) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('模型调用失败');
}
