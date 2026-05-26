import { generateObject, generateText, streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import fs from 'node:fs';
import path from 'node:path';
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
import {
  extractContextAroundError,
  recordLlmDebug,
} from '@/lib/llm-debug-logger';
import { randomUUID } from 'node:crypto';
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
  requestMetadata?: LumosLlmRequestMetadata;
}

export interface GenerateObjectImageRef {
  /** Local absolute path to an image file (jpg/png/webp). */
  path?: string;
  /** Alternatively pass an http(s) URL or data: URL the model can fetch. */
  url?: string;
  /** Display label so prompts can reference "Image 1, Image 2, ..." consistently. */
  label?: string;
}

export interface GenerateObjectParams<T> {
  providerId: string;
  model: string;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  /**
   * Optional vision attachments. When provided the request is sent as a
   * single user message containing the prompt text plus each image part.
   * The provider must be vision-capable; otherwise images are ignored.
   */
  images?: GenerateObjectImageRef[];
  maxTokens?: number;
  temperature?: number;
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
      ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
      abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
    });

    for await (const chunk of result.textStream) {
      yield chunk;
    }
    // 流耗尽后 totalUsage 已 resolve；接住真实 token（主聊天是消耗大头，不能漏）。
    const usage = await Promise.resolve(result.totalUsage).catch(() => undefined);
    requestLog.finish({ status: 'succeeded', usage });
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
      ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
      abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
    });

    requestLog.finish({ status: 'succeeded', usage: result.usage });
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

function buildImageContentParts(
  refs: GenerateObjectImageRef[],
): Array<{ type: 'image'; image: Buffer | URL }> {
  const parts: Array<{ type: 'image'; image: Buffer | URL }> = [];
  for (const ref of refs) {
    if (ref.url) {
      try {
        parts.push({ type: 'image', image: new URL(ref.url) });
        continue;
      } catch {
        // fall through to filesystem path
      }
    }
    if (ref.path) {
      const resolved = path.resolve(ref.path);
      try {
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) {
          throw new Error(`image path is not a regular file: ${resolved}`);
        }
        const buffer = fs.readFileSync(resolved);
        parts.push({ type: 'image', image: buffer });
      } catch (err) {
        throw new Error(
          `read image failed: ${resolved} — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  return parts;
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
    const imageParts = params.images?.length ? buildImageContentParts(params.images) : [];
    const baseArgs = {
      model,
      output: 'object' as const,
      system: params.system,
      schema: params.schema,
      maxOutputTokens: params.maxTokens || 4096,
      ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
      providerOptions: getObjectGenerationProviderOptions(provider),
      abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
    };
    const result = imageParts.length > 0
      ? await generateObject({
          ...baseArgs,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: params.prompt },
                ...imageParts,
              ],
            },
          ],
        })
      : await generateObject({
          ...baseArgs,
          prompt: params.prompt,
        });

    requestLog.finish({ status: 'succeeded', usage: result.usage });
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
 * Try generateObject first; if the provider cannot produce a valid structured object,
 * fall back to plain text generation with manual JSON extraction and Zod validation.
 *
 * Every stage records a JSON-Lines entry to `~/.lumos/llm-debug.log` with a
 * shared `requestId` so a post-mortem can `grep <id>` and see the entire
 * call chain. Errors are still rethrown — the logger only captures evidence.
 */
export async function generateObjectWithFallback<T>(params: GenerateObjectParams<T>): Promise<T> {
  const requestId = randomUUID();
  const baseLog = {
    requestId,
    providerId: params.providerId,
    model: params.model,
    module: params.requestMetadata?.module,
    operation: params.requestMetadata?.operation,
  };

  recordLlmDebug({
    ...baseLog,
    stage: 'request_started',
    detail: {
      promptChars: params.prompt.length,
      systemChars: params.system.length,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      path: 'generateObject',
    },
  });

  try {
    const result = await generateObjectFromProvider(params);
    recordLlmDebug({ ...baseLog, stage: 'request_succeeded', detail: { path: 'generateObject' } });
    return result;
  } catch (error) {
    if (!shouldFallbackToTextObjectGeneration(error)) {
      recordLlmDebug({
        ...baseLog,
        stage: 'request_failed',
        detail: {
          path: 'generateObject',
          error: error instanceof Error ? error.message : String(error),
          errorName: error instanceof Error ? error.name : undefined,
        },
      });
      throw error;
    }
    recordLlmDebug({
      ...baseLog,
      stage: 'fallback_to_text',
      detail: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
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
    requestMetadata: params.requestMetadata,
  });

  const jsonText = extractJsonObjectText(text);
  if (!jsonText) {
    recordLlmDebug({
      ...baseLog,
      stage: 'json_extract_failed',
      detail: {
        rawTextLength: text.length,
        rawText: text,
      },
    });
    throw new Error('Model response did not contain a JSON object (text fallback)');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (parseErr) {
    recordLlmDebug({
      ...baseLog,
      stage: 'json_parse_failed',
      detail: {
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        rawTextLength: text.length,
        extractedLength: jsonText.length,
        // Full raw text — clip safety lives in the logger.
        rawText: text,
        extractedJson: jsonText,
        // Window around the failing column so the human reader doesn't have
        // to count characters in a 30 KB blob to find position 800.
        contextAroundError: extractContextAroundError(jsonText, parseErr),
      },
    });
    throw parseErr;
  }

  try {
    return params.schema.parse(parsed);
  } catch (zodErr) {
    recordLlmDebug({
      ...baseLog,
      stage: 'schema_validation_failed',
      detail: {
        error: zodErr instanceof Error ? zodErr.message : String(zodErr),
        // Stringify the parsed object — keeps log line a single JSON.
        parsedJson: JSON.stringify(parsed),
      },
    });
    throw zodErr;
  }
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
