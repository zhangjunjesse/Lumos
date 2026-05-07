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
import {
  assertLlmProviderCircuitClosed,
  recordLlmProviderFailure,
} from '@/lib/llm-circuit-breaker';
import {
  buildLumosLlmRequestHeaders,
  type LumosLlmRequestMetadata,
} from '@/lib/llm-request-metadata';
import { startLlmRequestLog } from '@/lib/llm-request-log';
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
  abortSignal?: AbortSignal;
  requestMetadata?: LumosLlmRequestMetadata;
}

export interface GenerateObjectParams<T> {
  providerId: string;
  model: string;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  requestMetadata?: LumosLlmRequestMetadata;
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
function resolveProviderRequestHeaders(
  provider: ApiProvider,
  requestMetadata?: LumosLlmRequestMetadata,
): Record<string, string> | undefined {
  const channelId = getUpstreamChannelIdFromExtraEnv(parseProviderExtraEnv(provider.extra_env));
  const headers = {
    ...(channelId ? { 'Specific-Channel-Id': channelId } : {}),
    ...(buildLumosLlmRequestHeaders(requestMetadata) ?? {}),
  };
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Create an AI SDK language model instance from a provider config.
 */
function createLanguageModel(
  provider: ApiProvider,
  requestedModelId: string,
  requestMetadata?: LumosLlmRequestMetadata,
) {
  const apiKey = resolveProviderRequestApiKey(provider);
  const resolvedModelId = resolveProviderModelForRequest(provider, requestedModelId);
  const modelId = resolvedModelId || requestedModelId.trim();

  if (!modelId) {
    throw new Error(`服务商“${provider.name}”未解析出可用模型。`);
  }

  const headers = resolveProviderRequestHeaders(provider, requestMetadata);

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
  const resolvedModel = resolveProviderModelForRequest(provider, params.model) || params.model;
  const requestLog = startLlmRequestLog({
    provider,
    model: resolvedModel,
    requestMetadata: params.requestMetadata,
    prompt: params.prompt,
    messages: params.messages,
    maxTokens: params.maxTokens,
    transport: 'ai-sdk',
  });

  try {
    assertLlmProviderCircuitClosed(provider.id, provider.name);
    const model = createLanguageModel(provider, params.model, params.requestMetadata);
    const result = streamText({
      model,
      system: params.system,
      ...(params.messages ? { messages: params.messages } : { prompt: params.prompt! }),
      maxOutputTokens: params.maxTokens || 4096,
      abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
    });

    for await (const chunk of result.textStream) {
      yield chunk;
    }
    requestLog.finish({ status: 'succeeded' });
  } catch (error) {
    recordLlmProviderFailure({
      providerId: provider.id,
      providerName: provider.name,
      error,
    });
    requestLog.finish({
      status: error && typeof error === 'object' && (error as { code?: unknown }).code === 'llm_provider_circuit_open'
        ? 'blocked'
        : 'failed',
      error,
    });
    throw error;
  }
}

/**
 * Generate complete text (non-streaming) from the user's current provider.
 * Useful when you need the full response as a string.
 */
export async function generateTextFromProvider(params: StreamTextParams): Promise<string> {
  const provider = resolveProvider(params.providerId);
  const resolvedModel = resolveProviderModelForRequest(provider, params.model) || params.model;
  const requestLog = startLlmRequestLog({
    provider,
    model: resolvedModel,
    requestMetadata: params.requestMetadata,
    prompt: params.prompt,
    messages: params.messages,
    maxTokens: params.maxTokens,
    transport: 'ai-sdk',
  });
  try {
    assertLlmProviderCircuitClosed(provider.id, provider.name);
    const model = createLanguageModel(provider, params.model, params.requestMetadata);
    const result = await generateText({
      model,
      system: params.system,
      ...(params.messages ? { messages: params.messages } : { prompt: params.prompt! }),
      maxOutputTokens: params.maxTokens || 4096,
      abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
    });

    requestLog.finish({ status: 'succeeded' });
    return result.text;
  } catch (error) {
    recordLlmProviderFailure({
      providerId: provider.id,
      providerName: provider.name,
      error,
    });
    requestLog.finish({
      status: error && typeof error === 'object' && (error as { code?: unknown }).code === 'llm_provider_circuit_open'
        ? 'blocked'
        : 'failed',
      error,
    });
    throw error;
  }
}

export async function generateObjectFromProvider<T>(params: GenerateObjectParams<T>): Promise<T> {
  const provider = resolveProvider(params.providerId);
  const resolvedModel = resolveProviderModelForRequest(provider, params.model) || params.model;
  const requestLog = startLlmRequestLog({
    provider,
    model: resolvedModel,
    requestMetadata: params.requestMetadata,
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    transport: 'ai-sdk',
  });
  try {
    assertLlmProviderCircuitClosed(provider.id, provider.name);
    const model = createLanguageModel(provider, params.model, params.requestMetadata);
    const result = await generateObject({
      model,
      output: 'object',
      system: params.system,
      prompt: params.prompt,
      schema: params.schema,
      maxOutputTokens: params.maxTokens || 4096,
      providerOptions: getObjectGenerationProviderOptions(provider),
      abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
    });

    requestLog.finish({ status: 'succeeded' });
    return result.object;
  } catch (error) {
    recordLlmProviderFailure({
      providerId: provider.id,
      providerName: provider.name,
      error,
    });
    requestLog.finish({
      status: error && typeof error === 'object' && (error as { code?: unknown }).code === 'llm_provider_circuit_open'
        ? 'blocked'
        : 'failed',
      error,
    });
    throw error;
  }
}

/**
 * Try generateObject first; if the provider returns 400 (no structured output support),
 * fall back to plain text generation with manual JSON extraction and Zod validation.
 */
export async function generateObjectWithFallback<T>(params: GenerateObjectParams<T>): Promise<T> {
  try {
    return await generateObjectFromProvider(params);
  } catch (error) {
    const is400 = error instanceof Error && (
      error.message.toLowerCase().includes('bad request')
      || error.message.includes('400')
      || (
        'statusCode' in error
        && typeof (error as unknown as { statusCode: unknown }).statusCode === 'number'
        && (error as unknown as { statusCode: number }).statusCode === 400
      )
    );
    if (!is400) throw error;
  }

  // Fallback: plain text → JSON extraction → Zod parse
  const fallbackSystem = `${params.system}\n\nYou MUST respond with ONLY a valid JSON object. Do not include markdown fences, explanations, or any text outside the JSON.`;
  const text = await generateTextFromProvider({
    providerId: params.providerId,
    model: params.model,
    system: fallbackSystem,
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    abortSignal: params.abortSignal,
    requestMetadata: params.requestMetadata,
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Model response did not contain a JSON object (text fallback)');
  }

  const parsed: unknown = JSON.parse(jsonMatch[0]);
  return params.schema.parse(parsed);
}
