import { NextRequest, NextResponse } from 'next/server';
import { getProvider, resetBuiltinProvider } from '@/lib/db';
import type { ProviderResponse, ErrorResponse } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function maskApiKey(provider: { id: string; name: string; provider_type: string; base_url: string; api_key: string; is_active: number; sort_order: number; extra_env: string; notes: string; is_builtin: number; user_modified: number; created_at: string; updated_at: string }) {
  let maskedKey = provider.api_key;
  if (maskedKey && maskedKey.length > 8) {
    maskedKey = '***' + maskedKey.slice(-8);
  }
  return { ...provider, api_key: maskedKey };
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const provider = getProvider(id);
    if (!provider) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 }
      );
    }

    if (provider.is_builtin !== 1) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Only builtin providers can be reset' },
        { status: 400 }
      );
    }

    const reset = resetBuiltinProvider();
    if (!reset) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to reset provider' },
        { status: 500 }
      );
    }

    return NextResponse.json<ProviderResponse>({ provider: maskApiKey(reset) });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to reset provider' },
      { status: 500 }
    );
  }
}
