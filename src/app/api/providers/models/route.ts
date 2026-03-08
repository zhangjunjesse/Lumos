import { NextResponse } from 'next/server';
import { getAllProviders, getDefaultProviderId } from '@/lib/db';
import type { ApiProvider, ErrorResponse, ProviderModelGroup } from '@/types';

// Default Claude model options
const DEFAULT_MODELS = [
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'opus', label: 'Opus 4.6' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

// Provider-specific model label mappings (base_url -> alias -> display name)
const PROVIDER_MODEL_LABELS: Record<string, { value: string; label: string }[]> = {
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
  'https://openrouter.ai/api': [
    { value: 'sonnet', label: 'Sonnet 4.6' },
    { value: 'opus', label: 'Opus 4.6' },
    { value: 'haiku', label: 'Haiku 4.5' },
  ],
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().toLowerCase().replace(/\/+$/, '');
}

const NORMALIZED_PROVIDER_MODEL_LABELS = new Map<string, { value: string; label: string }[]>(
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

/**
 * Deduplicate models: if multiple aliases map to the same label, keep only the first one.
 */
function deduplicateModels(models: { value: string; label: string }[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  const result: { value: string; label: string }[] = [];
  for (const m of models) {
    if (!seen.has(m.label)) {
      seen.add(m.label);
      result.push(m);
    }
  }
  return result;
}

export async function GET() {
  try {
    const providers = getAllProviders();
    const groups: ProviderModelGroup[] = [];
    const defaultProviderId = getDefaultProviderId() || '';

    // Check for environment variables
    const hasEnvKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    if (hasEnvKey) {
      groups.push({
        provider_id: 'env',
        provider_name: 'Environment',
        provider_type: 'anthropic',
        models: DEFAULT_MODELS,
      });
    }

    // Provider types that are not LLMs (e.g. image generation) — skip in chat model selector
    const MEDIA_PROVIDER_TYPES = new Set(['gemini-image']);

    // Collapse providers that point to the same upstream to avoid duplicate model groups.
    const dedupedProviders = new Map<string, ApiProvider>();
    const providerKeyById = new Map<string, string>();

    for (const provider of providers) {
      if (MEDIA_PROVIDER_TYPES.has(provider.provider_type)) continue;
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

    // Build a group for each configured provider
    for (const provider of dedupedProviders.values()) {
      const matched = NORMALIZED_PROVIDER_MODEL_LABELS.get(normalizeBaseUrl(provider.base_url || ''));
      const rawModels = matched || DEFAULT_MODELS;
      const models = deduplicateModels(rawModels);

      groups.push({
        provider_id: provider.id,
        provider_name: provider.name,
        provider_type: provider.provider_type,
        models,
      });
    }

    // If no groups at all (no env, no providers), show default Anthropic group
    if (groups.length === 0) {
      groups.push({
        provider_id: 'env',
        provider_name: 'Anthropic',
        provider_type: 'anthropic',
        models: DEFAULT_MODELS,
      });
    }

    // Resolve default provider after deduplication.
    let resolvedDefaultProviderId = defaultProviderId;
    const groupIds = new Set(groups.map((g) => g.provider_id));

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
      resolvedDefaultProviderId = groups[0].provider_id;
    }

    return NextResponse.json({
      groups,
      default_provider_id: resolvedDefaultProviderId,
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get models' },
      { status: 500 }
    );
  }
}
