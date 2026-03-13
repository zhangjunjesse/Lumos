import { NextRequest, NextResponse } from 'next/server';
import { getProvider } from '@/lib/db';
import { detectProviderModels } from '@/lib/provider-model-discovery';
import type { ErrorResponse, ProviderModelOption } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface DetectModelsRequest {
  baseUrl?: string;
  apiKey?: string;
  providerType?: string;
}

interface DetectModelsResponse {
  models: ProviderModelOption[];
  base_url: string;
  model_catalog_source: 'detected';
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const provider = getProvider(id);
    if (!provider) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Provider not found' },
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => ({})) as DetectModelsRequest;
    const result = await detectProviderModels({
      provider,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      providerType: body.providerType,
    });

    return NextResponse.json<DetectModelsResponse>({
      models: result.models,
      base_url: result.baseUrl,
      model_catalog_source: 'detected',
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to detect models' },
      { status: 500 },
    );
  }
}
