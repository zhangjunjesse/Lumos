import { NextRequest, NextResponse } from 'next/server';
import {
  getAllProviders,
  createProvider,
  getDefaultProvider,
  ProviderValidationError,
} from '@/lib/db';
import type { ProviderResponse, ErrorResponse, CreateProviderRequest, ApiProvider } from '@/types';

function maskApiKey(provider: ApiProvider): ApiProvider {
  let maskedKey = provider.api_key;
  if (maskedKey && maskedKey.length > 8) {
    maskedKey = '***' + maskedKey.slice(-8);
  }
  return { ...provider, api_key: maskedKey };
}

export async function GET() {
  try {
    const providers = getAllProviders().map(maskApiKey);
    const defaultProvider = getDefaultProvider();
    return NextResponse.json({
      providers,
      default_provider_id: defaultProvider?.id || '',
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get providers' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateProviderRequest = await request.json();

    if (!body.name) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Missing required field: name' },
        { status: 400 }
      );
    }

    const provider = createProvider(body);
    return NextResponse.json<ProviderResponse>(
      { provider: maskApiKey(provider) },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ProviderValidationError) {
      return NextResponse.json<ErrorResponse>(
        { error: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to create provider' },
      { status: 500 }
    );
  }
}
