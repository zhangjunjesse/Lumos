import type { ChatSession } from '@/types';
import {
  APP_BUILDER_MODEL_KEY,
  APP_BUILDER_PROVIDER_KEY,
  APP_BUILDER_SYSTEM_PROMPT_KEY,
  DEFAULT_APP_BUILDER_SYSTEM_PROMPT,
} from '@/lib/app/builder/assistant-config';
import type { BuilderMessage, BuilderSession } from '@/lib/app/builder/session';
import { getAllProviders, getDefaultProvider, getProvider } from '@/lib/db';
import { getSetting } from '@/lib/db/sessions';
import { getProviderModelOptions } from '@/lib/model-metadata';
import { providerSupportsCapability } from '@/lib/provider-config';
import { resolveProviderRequestApiKey } from '@/lib/provider-model-discovery';
import type { ApiProvider, ProviderModelGroup } from '@/types';

export const APP_BUILDER_CHAT_TITLE = '应用开发助手';
export const APP_BUILDER_CHAT_MARKER = '__LUMOS_APP_BUILDER_CHAT__';

const APP_BUILDER_CHAT_BINDING_KEY_PREFIX = 'app_builder_chat_session:';

export function buildAppBuilderChatSessionBindingKey(builderSessionId: string): string {
  return `${APP_BUILDER_CHAT_BINDING_KEY_PREFIX}${builderSessionId}`;
}

export function isAppBuilderChatSession(session?: Pick<ChatSession, 'system_prompt'> | null): boolean {
  return Boolean(session?.system_prompt?.includes(APP_BUILDER_CHAT_MARKER));
}

export function buildAppBuilderChatSystemPrompt(builderSession?: BuilderSession | null): string {
  const configuredPrompt = getSetting(APP_BUILDER_SYSTEM_PROMPT_KEY) || '';
  const basePrompt = configuredPrompt || DEFAULT_APP_BUILDER_SYSTEM_PROMPT;
  const appName = builderSession?.appName || '未命名应用';
  const appDescription = builderSession?.appDescription || '未填写';
  const nonGoals = extractNonGoals(builderSession?.needsSummary);

  return [
    APP_BUILDER_CHAT_MARKER,
    basePrompt,
    '',
    '当前界面布局：主区域提供预览、代码、需求、项目状态和详情切换；底部是与你对话的应用开发助手。不要把对话区描述成右侧。',
    '',
    '当前应用草稿：',
    `- builderSessionId: ${builderSession?.id || 'unknown'}`,
    `- appName: ${appName}`,
    `- appDescription: ${appDescription}`,
    `- status: ${builderSession?.status || 'unknown'}`,
    `- nonGoals: ${nonGoals.length > 0 ? nonGoals.join('、') : '(暂无)'}`,
  ].join('\n');
}

function extractNonGoals(summary: Record<string, unknown> | undefined): string[] {
  const raw = summary?.nonGoals;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function resolveAppBuilderProviderAndModel(
  overrides?: { providerId?: string; model?: string },
): { providerId: string; model: string } | { error: string } {
  const configuredProviderId = (overrides?.providerId || getSetting(APP_BUILDER_PROVIDER_KEY) || '').trim();
  const configuredModel = (overrides?.model || getSetting(APP_BUILDER_MODEL_KEY) || '').trim();
  const provider = resolveAppBuilderProvider(configuredProviderId);

  if (!provider) {
    return {
      error:
        '未配置应用开发助手可用的 AI 服务商。请到 设置 > AI助手 > 应用开发助手 选择支持文本生成且使用 API Key 的服务商。',
    };
  }

  const model =
    configuredModel ||
    getProviderModelOptions(provider)[0]?.value?.trim() ||
    '';

  if (!model) {
    return { error: '应用开发助手没有可用模型，请先在服务商模型列表中配置模型。' };
  }

  return { providerId: provider.id, model };
}

export function listAppBuilderProviderModelGroups(): {
  groups: ProviderModelGroup[];
  default_provider_id: string;
} {
  const groups = getAllProviders()
    .filter(isUsableAppBuilderProvider)
    .map((provider) => {
      const models = getProviderModelOptions(provider);
      return {
        provider_id: provider.id,
        provider_name: provider.name,
        provider_type: provider.provider_type,
        provider_origin: provider.provider_origin || 'custom',
        models,
        model_catalog_source: provider.model_catalog_source,
        model_catalog_updated_at: provider.model_catalog_updated_at,
        model_catalog_uses_default: provider.model_catalog_source === 'default',
      };
    })
    .filter((group) => group.models.length > 0);

  const configuredProviderId = (getSetting(APP_BUILDER_PROVIDER_KEY) || '').trim();
  const defaultProvider = resolveAppBuilderProvider(configuredProviderId);
  const groupIds = new Set(groups.map((group) => group.provider_id));
  const defaultProviderId = defaultProvider && groupIds.has(defaultProvider.id)
    ? defaultProvider.id
    : groups[0]?.provider_id || '';

  return {
    groups,
    default_provider_id: defaultProviderId,
  };
}

function resolveAppBuilderProvider(configuredProviderId: string): ApiProvider | undefined {
  const candidates: Array<ApiProvider | undefined> = [];

  if (configuredProviderId) {
    candidates.push(getProvider(configuredProviderId));
  }

  candidates.push(getDefaultProvider());
  candidates.push(...getAllProviders());

  const seen = new Set<string>();
  for (const provider of candidates) {
    if (!provider || seen.has(provider.id)) continue;
    seen.add(provider.id);
    if (isUsableAppBuilderProvider(provider)) {
      return provider;
    }
  }

  return undefined;
}

function isUsableAppBuilderProvider(provider: ApiProvider): boolean {
  return (
    providerSupportsCapability(provider, 'text-gen')
    && provider.auth_mode !== 'local_auth'
    && resolveProviderRequestApiKey(provider).trim().length > 0
    && getProviderModelOptions(provider).length > 0
  );
}

export function formatBuilderMessageForChat(message: BuilderMessage): string {
  if (typeof message.content === 'string') {
    return message.content;
  }

  if (message.role === 'tool') {
    const content = message.content;
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      const record = content as Record<string, unknown>;
      const summary = typeof record.summary === 'string' ? record.summary : '';
      const files = Array.isArray(record.files)
        ? record.files.filter((file): file is string => typeof file === 'string')
        : [];
      return [summary, files.length > 0 ? `更新文件：${files.join(', ')}` : '']
        .filter(Boolean)
        .join('\n');
    }
  }

  try {
    return JSON.stringify(message.content, null, 2);
  } catch {
    return String(message.content ?? '');
  }
}
