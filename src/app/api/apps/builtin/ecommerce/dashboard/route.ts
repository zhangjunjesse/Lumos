import { NextResponse } from 'next/server';

import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';
import { buildDashboard } from '@/lib/ecommerce-assistant/dashboard';
import { resolveProviderForCapability, ProviderResolutionError } from '@/lib/provider-resolver';
import { providerSupportsCapability } from '@/lib/provider-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const snapshot = buildDashboard(store, {
      hasImageProvider: hasProvider('image'),
      hasAnalysisProvider: hasProvider('analysis'),
    });
    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function hasProvider(kind: 'image' | 'analysis'): boolean {
  try {
    const provider =
      kind === 'image'
        ? resolveProviderForCapability({
            moduleKey: 'image',
            capability: 'image-gen',
            allowDefault: false,
          })
        : resolveProviderForCapability({ moduleKey: 'agent', capability: 'agent-chat' });
    if (!provider) return false;
    return providerSupportsCapability(provider, kind === 'image' ? 'image-gen' : 'text-gen');
  } catch (err) {
    if (err instanceof ProviderResolutionError) return false;
    return false;
  }
}
