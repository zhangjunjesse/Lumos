import { NextResponse } from 'next/server';
import { getBuiltinProvider, resetBuiltinProvider } from '@/lib/db';
import type { ProviderResponse, ErrorResponse } from '@/types';

function maskApiKey(key: string): string {
  if (key && key.length > 8) {
    return '***' + key.slice(-8);
  }
  return key;
}

export async function POST() {
  try {
    const builtin = getBuiltinProvider();
    if (!builtin) {
      return NextResponse.json<ErrorResponse>(
        { error: 'No builtin provider found' },
        { status: 404 }
      );
    }

    const resetProvider = resetBuiltinProvider();
    if (!resetProvider) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Failed to reset builtin provider' },
        { status: 500 }
      );
    }

    return NextResponse.json<ProviderResponse>({
      provider: { ...resetProvider, api_key: maskApiKey(resetProvider.api_key) },
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to reset builtin provider' },
      { status: 500 }
    );
  }
}
