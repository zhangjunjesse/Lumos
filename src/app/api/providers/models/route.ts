import { NextResponse } from 'next/server';
import { getAllProviders, getDefaultProviderId } from '@/lib/db';
import { DEFAULT_PROVIDER_MODEL_OPTIONS, getProviderModelCatalogMeta } from '@/lib/model-metadata';
import type { ApiProvider, ErrorResponse, ProviderModelGroup, ProviderModelOption } from '@/types';

const PROVIDER_MODEL_LABELS: Record<string, ProviderModelOption[]> = {
  'https://api.z.ai/api/anthropic': [
    { value: 'sonnet', label: 'GLM-4.7' },
    { value: 'opus', label: 'GLM-5' },
    { value: 'haiku', label: 'GLM-4.5-Air' },
  ],
  'https://open.bigmodel.cn/api/anthropic': [
    { value: 'sonnet', label: 'GLM-4.7' },
    { value: 'opus', label: 'GLM-5' },
    { value: 'haiku', label: 'GLM-4.5-Air' },
  ],
  'https://api.kimi.com/coding/': [
    { value: 'sonnet', label: 'Kimi K2.5' },
    { value: 'opus', label: 'Kimi K2.5' },
    { value: 'haiku', label: 'Kimi K2.5' },
  ],
  'https://api.moonshot.ai/anthropic': [
    { value: 'sonnet', label: 'Kimi K2.5' },
    { value: 'opus', label: 'Kimi K2.5' },
    { value: 'haiku', label: 'Kimi K2.5' },
  ],
  'https://api.moonshot.cn/anthropic': [
    { value: 'sonnet', label: 'Kimi K2.5' },
    { value: 'opus', label: 'Kimi K2.5' },
    { value: 'haiku', label: 'Kimi K2.5' },
  ],
  'https://api.minimaxi.com/anthropic': [
    { value: 'sonnet', label: 'MiniMax-M2.5' },
    { value: 'opus', label: 'MiniMax-M2.5' },
    { value: 'haiku', label: 'MiniMax-M2.5' },
  ],
  'https://api.minimax.io/anthropic': [
    { value: 'sonnet', label: 'MiniMax-M2.5' },
    { value: 'opus', label: 'MiniMax-M2.5' },
    { value: 'haiku', label: 'MiniMax-M2.5' },
  ],
  'https://openrouter.ai/api': DEFAULT_PROVIDER_MODEL_OPTIONS,
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().toLowerCase().replace(/\/+$/, '');
}

const NORMALIZED_PROVIDER_MODEL_LABELS = new Map<string, ProviderModelOption[]>(
  Object.entries(PROVIDER_MODEL_LABELS).map(([baseUrl, labels]) => [normalizeBaseUrl(baseUrl), labels]),
);

function getProviderGroupKey(provider: ApiProvider): string {
  const normalizedBaseUrl = normalizeBaseUrl(provider.base_url || '');
  if (!normalizedBaseUrl) {
    return `${provider.provider_type}::id:${provider.id}`;
  }
  return `${provider.provider_type}::${normalizedBaseUrl}`;
}

function providerPriority(provider: ApiProvider, defaultProviderId: string): number {
  if (provider.id === defaultProviderId) return 3;
  if (provider.is_active === 1) return 2;
  if (provider.is_builtin === 1) return 1;
  return 0;
}

function deduplicateModels(models: ProviderModelOption[]): ProviderModelOption[] {
  const seen = new Set<string>();
  const result: ProviderModelOption[] = [];

  for (const model of models) {
    const key = `${model.value}::${model.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
  }

  return result;
}

export async function GET() {
  try {
    const providers = getAllProviders();
    const defaultProviderId = getDefaultProviderId() || '';
    const groups: ProviderModelGroup[] = [];
    const dedupedProviders = new Map<string, ApiProvider>();
    const providerKeyById = new Map<string, string>();
    const hasEnvKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

    for (const provider of providers) {
      if (provider.provider_type === 'gemini-image') continue;
      const key = getProviderGroupKey(provider);
      providerKeyById.set(provider.id, key);

      const existing = dedupedProviders.get(key);
      if (!existing) {
        dedupedProviders.set(key, provider);
        continue;
      }

      const existingPriority = providerPriority(existing, defaultProviderId);
      const candidatePriority = providerPriority(provider, defaultProviderId);
      if (candidatePriority > existingPriority) {
        dedupedProviders.set(key, provider);
      }
    }

    for (const provider of dedupedProviders.values()) {
      const catalog = getProviderModelCatalogMeta(provider);
      const serviceSpecificDefaults = catalog.usesDefault
        ? NORMALIZED_PROVIDER_MODEL_LABELS.get(normalizeBaseUrl(provider.base_url || ''))
        : undefined;
      const models = deduplicateModels(serviceSpecificDefaults || catalog.models);

      groups.push({
        provider_id: provider.id,
        provider_name: provider.name,
        provider_type: provider.provider_type,
        models,
        model_catalog_source: catalog.source,
        model_catalog_updated_at: catalog.updatedAt,
        model_catalog_uses_default: catalog.usesDefault,
      });
    }

    if (groups.length === 0 && hasEnvKey) {
      groups.push({
        provider_id: 'env',
        provider_name: 'Environment',
        provider_type: 'anthropic',
        models: DEFAULT_PROVIDER_MODEL_OPTIONS,
        model_catalog_source: 'default',
        model_catalog_updated_at: null,
        model_catalog_uses_default: true,
      });
    }

    if (groups.length === 0) {
      groups.push({
        provider_id: 'env',
        provider_name: 'Anthropic',
        provider_type: 'anthropic',
        models: DEFAULT_PROVIDER_MODEL_OPTIONS,
        model_catalog_source: 'default',
        model_catalog_updated_at: null,
        model_catalog_uses_default: true,
      });
    }

    const groupIds = new Set(groups.map((group) => group.provider_id));
    let resolvedDefaultProviderId = defaultProviderId;

    if (!resolvedDefaultProviderId || !groupIds.has(resolvedDefaultProviderId)) {
      const key = resolvedDefaultProviderId ? providerKeyById.get(resolvedDefaultProviderId) : undefined;
      if (key) {
        const resolved = dedupedProviders.get(key);
        if (resolved && groupIds.has(resolved.id)) {
          resolvedDefaultProviderId = resolved.id;
        }
      }
    }

    if (!resolvedDefaultProviderId || !groupIds.has(resolvedDefaultProviderId)) {
      const firstConfiguredGroup = groups.find((group) => group.provider_id !== 'env');
      resolvedDefaultProviderId = firstConfiguredGroup?.provider_id || groups[0].provider_id;
    }

    return NextResponse.json({
      groups,
      default_provider_id: resolvedDefaultProviderId,
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get models' },
      { status: 500 },
    );
  }
}
