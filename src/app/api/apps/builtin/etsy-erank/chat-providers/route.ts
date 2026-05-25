import { NextResponse } from 'next/server';

import { getAllProviders, getDefaultProvider } from '@/lib/db';
import { providerSupportsCapability } from '@/lib/provider-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 列出 ChatDock 可用的 provider:支持 text-gen + 非 local_auth + api 协议受支持
export async function GET() {
  const def = getDefaultProvider();
  const all = getAllProviders();
  const usable = all
    .filter((p) => providerSupportsCapability(p, 'text-gen'))
    .filter((p) => p.auth_mode !== 'local_auth')
    .filter((p) => p.api_protocol === 'anthropic-messages')
    .map((p) => {
      let models: Array<{ value: string; label: string }> = [];
      try {
        models = (JSON.parse(p.model_catalog || '[]') as Array<{ value: string; label?: string }>)
          .filter((m) => m.value)
          .map((m) => ({ value: m.value, label: m.label || m.value }));
      } catch { /* ignore */ }
      return {
        id: p.id,
        name: p.name,
        baseUrl: p.base_url,
        models,
        isDefault: def?.id === p.id,
      };
    });
  return NextResponse.json({ providers: usable, defaultProviderId: def?.id ?? '' });
}
