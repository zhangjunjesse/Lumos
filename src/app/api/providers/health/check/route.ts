import { NextRequest, NextResponse } from 'next/server';
import {
  checkProviderHealth,
  ProviderHealthNotFoundError,
  ProviderHealthValidationError,
} from '@/lib/providers/provider-health-service';
import type { ProviderHealthResult } from '@/lib/providers/provider-health-types';
import type { ErrorResponse } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProviderHealthCheckRequest {
  providerId?: string;
  model?: string;
  force?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as ProviderHealthCheckRequest;
    const result = await checkProviderHealth({
      providerId: body.providerId || '',
      model: body.model,
      force: body.force === true,
    });

    return NextResponse.json<ProviderHealthResult>(result);
  } catch (error) {
    if (error instanceof ProviderHealthValidationError) {
      return NextResponse.json<ErrorResponse>({ error: error.message }, { status: 400 });
    }
    if (error instanceof ProviderHealthNotFoundError) {
      return NextResponse.json<ErrorResponse>({ error: error.message }, { status: 404 });
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to check provider health' },
      { status: 500 },
    );
  }
}

