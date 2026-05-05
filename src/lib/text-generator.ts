import { generateObject, generateText, streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { SharedV3ProviderOptions } from '@ai-sdk/provider';
import { getProvider } from '@/lib/db';
import { providerSupportsCapability } from '@/lib/provider-config';
import {
  parseProviderExtraEnv,
  resolveAnthropicSdkBaseUrl,
  resolveProviderRequestApiKey,
} from '@/lib/provider-model-discovery';
import { getUpstreamChannelIdFromExtraEnv } from '@/lib/claude/provider-env';
import { resolveProviderModelForRequest } from '@/lib/model-metadata';
import type { ApiProvider } from '@/types';
import type { ZodType } from 'zod';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamTextParams {
  providerId: string;
  model: string;
  system: string;
  /** Single-turn prompt. Use this OR `messages`, not both. */
  prompt?: string;
  /** Multi-turn messages. Use this OR `prompt`, not both. */
  messages?: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface GenerateObjectParams<T> {
  providerId: string;
  model: string;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

function getObjectGenerationProviderOptions(provider: ApiProvider): SharedV3ProviderOptions | undefined {
  if (provider.api_protocol === 'anthropic-messages') {
    return {
      anthropic: {
        // Custom Anthropic-compatible gateways in this repo are more stable with tool-based
        // structured output than with the newer native json_schema payload.
        structuredOutputMode: 'jsonTool',
      },
    };
  }

  return undefined;
}

function resolveProvider(providerId: string): ApiProvider {
  const normalizedProviderId = providerId.trim();
  if (!normalizedProviderId) {
    throw new Error('未指定文本生成服务商，请先选择一个支持文本生成的 provider。');
  }

  const preferredProvider = getProvider(normalizedProviderId);
  if (!preferredProvider) {
    throw new Error('指定的文本生成服务商不存在，请重新选择后重试。');
  }
  if (!providerSupportsCapability(preferredProvider, 'text-gen')) {
    throw new Error(`服务商“${preferredProvider.name}”不支持文本生成。`);
  }
  if (preferredProvider.auth_mode === 'local_auth') {
    throw new Error(`服务商“${preferredProvider.name}”当前使用 local_auth，暂不支持轻量文本生成功能。`);
  }
  if (!resolveProviderRequestApiKey(preferredProvider)) {
    throw new Error(`服务商“${preferredProvider.name}”未配置可用的 API Key。`);
  }

  return preferredProvider;
}

function resolveTextGenerationBaseUrl(provider: ApiProvider): string | undefined {
  const extraEnv = parseProviderExtraEnv(provider.extra_env);

  if (provider.api_protocol === 'anthropic-messages') {
    return resolveAnthropicSdkBaseUrl(provider);
  }

  return (
    provider.base_url?.trim()
    || extraEnv.OPENAI_BASE_URL?.trim()
    || extraEnv.OPENAI_API_BASE?.trim()
    || extraEnv.BASE_URL?.trim()
    || (
      provider.provider_type === 'openrouter'
        ? 'https://openrouter.ai/api/v1'
        : undefined
    )
  );
}

/**
 * Build per-request HTTP headers that the AI SDK must attach in addition to
 * its default auth headers. `resolveProviderRequestApiKey()` already applies
 * new-api's admin-token `-<channelId>` suffix, while this compatibility header
 * keeps older gateways that still inspect `Specific-Channel-Id` working.
 */
function resolveProviderRequestHeaders(provider: ApiProvider): Record<string, string> | undefined {
  const channelId = getUpstreamChannelIdFromExtraEnv(parseProviderExtraEnv(provider.extra_env));
  return channelId ? { 'Specific-Channel-Id': channelId } : undefined;
}

/**
 * Create an AI SDK language model instance from a provider config.
 */
function createLanguageModel(provider: ApiProvider, requestedModelId: string) {
  const apiKey = resolveProviderRequestApiKey(provider);
  const resolvedModelId = resolveProviderModelForRequest(provider, requestedModelId);
  const modelId = resolvedModelId || requestedModelId.trim();

  if (!modelId) {
    throw new Error(`服务商“${provider.name}”未解析出可用模型。`);
  }

  const headers = resolveProviderRequestHeaders(provider);

  if (provider.api_protocol === 'anthropic-messages') {
    const anthropic = createAnthropic({
      apiKey,
      baseURL: resolveTextGenerationBaseUrl(provider),
      headers,
    });
    return anthropic(modelId);
  }

  if (provider.api_protocol === 'openai-compatible') {
    const baseURL = resolveTextGenerationBaseUrl(provider);
    if (!baseURL) {
      throw new Error(`服务商“${provider.name}”缺少 base_url，无法按 OpenAI 兼容协议调用。`);
    }
    const custom = createOpenAI({
      apiKey,
      baseURL,
      headers,
    });
    return custom(modelId);
  }

  throw new Error(`服务商“${provider.name}”的协议“${provider.api_protocol}”暂不支持文本生成调用。`);
}

/**
 * Stream text from the user's current provider.
 * Returns an async iterable of text chunks.
 */
export async function* streamTextFromProvider(params: StreamTextParams): AsyncIterable<string> {
  const provider = resolveProvider(params.providerId);
  const model = createLanguageModel(provider, params.model);

  const result = streamText({
    model,
    system: params.system,
    ...(params.messages ? { messages: params.messages } : { prompt: params.prompt! }),
    maxOutputTokens: params.maxTokens || 4096,
    ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
    abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

/**
 * Generate complete text (non-streaming) from the user's current provider.
 * Useful when you need the full response as a string.
 */
export async function generateTextFromProvider(params: StreamTextParams): Promise<string> {
  const provider = resolveProvider(params.providerId);
  const model = createLanguageModel(provider, params.model);
  const result = await generateText({
    model,
    system: params.system,
    ...(params.messages ? { messages: params.messages } : { prompt: params.prompt! }),
    maxOutputTokens: params.maxTokens || 4096,
    ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
    abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
  });

  return result.text;
}

export async function generateObjectFromProvider<T>(params: GenerateObjectParams<T>): Promise<T> {
  const provider = resolveProvider(params.providerId);
  const model = createLanguageModel(provider, params.model);
  const result = await generateObject({
    model,
    output: 'object',
    system: params.system,
    prompt: params.prompt,
    schema: params.schema,
    maxOutputTokens: params.maxTokens || 4096,
    ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
    providerOptions: getObjectGenerationProviderOptions(provider),
    abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
  });

  return result.object;
}

/**
 * Try generateObject first; if the provider cannot produce a valid structured object,
 * fall back to plain text generation with manual JSON extraction and Zod validation.
 */
export async function generateObjectWithFallback<T>(params: GenerateObjectParams<T>): Promise<T> {
  try {
    return await generateObjectFromProvider(params);
  } catch (error) {
    if (!shouldFallbackToTextObjectGeneration(error)) throw error;
  }

  // Fallback: plain text → JSON extraction → Zod parse
  const fallbackSystem = `${params.system}\n\nYou MUST respond with ONLY a valid JSON object. Do not include markdown fences, explanations, or any text outside the JSON.`;
  const text = await generateTextFromProvider({
    providerId: params.providerId,
    model: params.model,
    system: fallbackSystem,
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    abortSignal: params.abortSignal,
  });

  const jsonText = extractJsonObjectText(text);
  if (!jsonText) {
    throw new Error('Model response did not contain a JSON object (text fallback)');
  }

  const parsed: unknown = JSON.parse(jsonText);
  return params.schema.parse(parsed);
}

function shouldFallbackToTextObjectGeneration(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const statusCode =
    'statusCode' in error && typeof (error as unknown as { statusCode: unknown }).statusCode === 'number'
      ? (error as unknown as { statusCode: number }).statusCode
      : undefined;
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';

  return (
    statusCode === 400
    || message.includes('bad request')
    || message.includes('400')
    || name === 'AI_NoObjectGeneratedError'
    || message.includes('no object generated')
    || message.includes('response did not match schema')
    || message.includes('could not parse the response')
  );
}

function extractJsonObjectText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
  if (fenced?.startsWith('{')) return fenced;
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  return findFirstBalancedJsonObject(trimmed);
}

function findFirstBalancedJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (start === -1) {
      if (char === '{') {
        start = i;
        depth = 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
