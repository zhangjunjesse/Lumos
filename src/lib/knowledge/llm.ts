import { getSetting } from '@/lib/db';
import {
  BUILTIN_CLAUDE_MODEL_IDS,
  findProviderModelOption,
  getProviderModelOptions,
  inferRequestedModelAlias,
  resolveBuiltInClaudeModelId,
} from '@/lib/model-metadata';
import { providerSupportsCapability } from '@/lib/provider-config';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import {
  generateObjectFromProvider,
  generateTextFromProvider,
} from '@/lib/text-generator';
import type { ApiProvider } from '@/types';
import type { ZodType } from 'zod';

interface KnowledgeLlmRequest {
  model: string;
  maxTokens: number;
  prompt: string;
  system?: string;
  timeoutMs?: number;
  fallbackModels?: string[];
}

interface KnowledgeObjectLlmRequest<T> {
  model: string;
  prompt: string;
  schema: ZodType<T>;
  system?: string;
  timeoutMs?: number;
  maxTokens?: number;
  fallbackModels?: string[];
}

export class KnowledgeEnhancementUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeEnhancementUnavailableError';
  }
}

export function isKnowledgeEnhancementUnavailableError(
  error: unknown,
): error is KnowledgeEnhancementUnavailableError {
  return error instanceof KnowledgeEnhancementUnavailableError;
}

function isSupportedProvider(provider: ApiProvider | undefined): provider is ApiProvider {
  if (!provider) return false;
  return providerSupportsCapability(provider, 'text-gen');
}

/**
 * Resolve the default model for knowledge operations.
 * Uses the provider's first configured model instead of hardcoding Claude Haiku.
 */
export function getKnowledgeDefaultModel(): string {
  const override = getSetting('model_override:knowledge')?.trim();
  if (override) return override;

  const provider = resolveKnowledgeProvider();
  const options = getProviderModelOptions(provider);

  if (options.length > 0) {
    return options[0].value;
  }

  // Anthropic-protocol providers without custom models: fall back to built-in haiku
  if (provider.api_protocol === 'anthropic-messages') {
    return BUILTIN_CLAUDE_MODEL_IDS.haiku;
  }

  throw new KnowledgeEnhancementUnavailableError(
    `知识库服务"${provider.name}"没有配置可用模型，请在设置中添加模型。`,
  );
}

function resolveKnowledgeProvider(): ApiProvider {
  const provider = resolveProviderForCapability({
    moduleKey: 'knowledge',
    capability: 'text-gen',
  });

  if (!isSupportedProvider(provider)) {
    throw new KnowledgeEnhancementUnavailableError(
      '知识库增强分析未启用：请在“设置 > 服务商”中为知识库选择一个明确支持文本处理的 API Key 服务。',
    );
  }

  if (provider.auth_mode === 'local_auth') {
    throw new KnowledgeEnhancementUnavailableError(
      `知识库增强分析未启用：当前服务“${provider.name}”使用 local_auth，请改用 API Key 类型的文本服务。`,
    );
  }

  return provider;
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

function isClaudeStyleModelRequest(value?: string | null): boolean {
  const normalized = value?.trim().toLowerCase() || '';
  if (!normalized) return false;
  if (normalized.startsWith('claude-')) return true;

  const alias = inferRequestedModelAlias(normalized);
  return alias === 'sonnet' || alias === 'opus' || alias === 'haiku';
}

function pushUniqueCandidate(target: string[], value?: string | null): void {
  const normalized = value?.trim();
  if (!normalized || target.includes(normalized)) {
    return;
  }
  target.push(normalized);
}

function hasNonClaudeConfiguredModel(provider: ApiProvider): boolean {
  return getProviderModelOptions(provider)
    .some((model) => !isClaudeStyleModelRequest(model.value));
}

function resolveModelCandidates(
  provider: ApiProvider,
  requestedModel: string,
  fallbackModels?: string[],
): string[] {
  const configuredProviderModels = getProviderModelOptions(provider);
  const hasCustomConfiguredModel = hasNonClaudeConfiguredModel(provider);
  const candidates = [
    requestedModel,
    ...(fallbackModels || []),
    getSetting('default_model'),
  ];

  const unique: string[] = [];
  for (const model of candidates) {
    if (!model || !model.trim()) continue;

    const trimmed = model.trim();
    const providerModel = findProviderModelOption(trimmed, configuredProviderModels);
    if (providerModel) {
      pushUniqueCandidate(unique, providerModel.value);
      continue;
    }

    if (provider.api_protocol === 'anthropic-messages') {
      if (!isClaudeStyleModelRequest(trimmed)) {
        pushUniqueCandidate(unique, trimmed);
        continue;
      }

      if (!hasCustomConfiguredModel) {
        pushUniqueCandidate(unique, resolveBuiltInClaudeModelId(trimmed, 'sonnet'));
      }
      continue;
    }

    if (!isClaudeStyleModelRequest(trimmed)) {
      pushUniqueCandidate(unique, trimmed);
    }
  }

  for (const providerModel of configuredProviderModels) {
    pushUniqueCandidate(unique, providerModel.value);
  }

  if (provider.api_protocol === 'anthropic-messages' && !hasCustomConfiguredModel) {
    pushUniqueCandidate(unique, BUILTIN_CLAUDE_MODEL_IDS.sonnet);
    pushUniqueCandidate(unique, BUILTIN_CLAUDE_MODEL_IDS.haiku);
  }

  if (unique.length === 0 && provider.api_protocol === 'openai-compatible') {
    throw new KnowledgeEnhancementUnavailableError(
      `知识库服务商“${provider.name}”未配置可用模型。请在“设置 > 服务商”中为该 provider 填写模型列表，或改用已内置模型的服务商。`,
    );
  }

  return unique;
}

async function callKnowledgeModelOnce(params: {
  providerId: string;
  model: string;
  maxTokens: number;
  prompt: string;
  system?: string;
  timeoutMs: number;
}): Promise<string> {
  return generateTextFromProvider({
    providerId: params.providerId,
    model: params.model,
    system: params.system || '',
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    abortSignal: AbortSignal.timeout(params.timeoutMs),
  });
}

async function callKnowledgeObjectModelOnce<T>(params: {
  providerId: string;
  model: string;
  prompt: string;
  schema: ZodType<T>;
  system?: string;
  timeoutMs: number;
  maxTokens?: number;
}): Promise<T> {
  return generateObjectFromProvider({
    providerId: params.providerId,
    model: params.model,
    system: params.system || '',
    prompt: params.prompt,
    schema: params.schema,
    maxTokens: params.maxTokens,
    abortSignal: AbortSignal.timeout(params.timeoutMs),
  });
}

export async function callKnowledgeModel(params: KnowledgeLlmRequest): Promise<string> {
  const provider = resolveKnowledgeProvider();
  const timeoutMs = Number.isFinite(params.timeoutMs) ? Math.max(1000, Number(params.timeoutMs)) : 8000;
  const modelCandidates = resolveModelCandidates(provider, params.model, params.fallbackModels);

  let lastError: Error | null = null;
  for (let i = 0; i < modelCandidates.length; i += 1) {
    const model = modelCandidates[i];
    try {
      const text = await callKnowledgeModelOnce({
        providerId: provider.id,
        model,
        maxTokens: params.maxTokens,
        prompt: params.prompt,
        system: params.system,
        timeoutMs,
      });
      if (i > 0) {
        console.warn(`[kb] Model fallback applied: ${params.model} -> ${model}`);
      }
      if (!text.trim()) {
        console.warn(`[kb] Model "${model}" on provider "${provider.name}" returned empty response`);
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

export async function callKnowledgeObjectModel<T>(
  params: KnowledgeObjectLlmRequest<T>,
): Promise<T> {
  const provider = resolveKnowledgeProvider();
  const timeoutMs = Number.isFinite(params.timeoutMs) ? Math.max(1000, Number(params.timeoutMs)) : 8000;
  const modelCandidates = resolveModelCandidates(provider, params.model, params.fallbackModels);

  let lastError: Error | null = null;
  for (let i = 0; i < modelCandidates.length; i += 1) {
    const model = modelCandidates[i];
    try {
      const result = await callKnowledgeObjectModelOnce({
        providerId: provider.id,
        model,
        prompt: params.prompt,
        schema: params.schema,
        system: params.system,
        timeoutMs,
        maxTokens: params.maxTokens,
      });
      if (i > 0) {
        console.warn(`[kb] Object model fallback applied: ${params.model} -> ${model}`);
      }
      return result;
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
