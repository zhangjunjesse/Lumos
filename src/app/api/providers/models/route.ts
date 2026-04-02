import { NextResponse } from 'next/server';
import { getAllProviders, getDefaultProvider } from '@/lib/db';
import { getProviderModelCatalogMeta } from '@/lib/model-metadata';
import { providerSupportsCapability } from '@/lib/provider-config';
import type { ErrorResponse, ProviderModelGroup, ProviderModelOption } from '@/types';

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
    const defaultProviderId = getDefaultProvider()?.id || '';
    const groups: ProviderModelGroup[] = [];

    for (const provider of providers) {
      if (!providerSupportsCapability(provider, 'agent-chat')) continue;
      const catalog = getProviderModelCatalogMeta(provider);
      const models = deduplicateModels(catalog.models);

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

    const groupIds = new Set(groups.map((group) => group.provider_id));
    let resolvedDefaultProviderId = defaultProviderId;

    if (!resolvedDefaultProviderId || !groupIds.has(resolvedDefaultProviderId)) {
      resolvedDefaultProviderId = groups[0]?.provider_id || '';
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
