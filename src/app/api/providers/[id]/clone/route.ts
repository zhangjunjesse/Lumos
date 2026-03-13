import { NextRequest, NextResponse } from 'next/server';
import { cloneProvider, getProvider } from '@/lib/db';
import type { ErrorResponse, ProviderResponse, ApiProvider } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function maskApiKey(provider: ApiProvider): ApiProvider {
  let maskedKey = provider.api_key;
  if (maskedKey && maskedKey.length > 8) {
    maskedKey = '***' + maskedKey.slice(-8);
  }
  return { ...provider, api_key: maskedKey };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const existing = getProvider(id);
    if (!existing) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing required field: name' },
        { status: 400 },
      );
    }

    const cloned = cloneProvider(id, name);
    if (!cloned) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to clone provider' },
        { status: 500 },
      );
    }

    return NextResponse.json<ProviderResponse>({ provider: maskApiKey(cloned) });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to clone provider' },
      { status: 500 },
    );
  }
}
