import { NextRequest, NextResponse } from 'next/server';
import {
  BrowserProviderInUseError,
  deleteBrowserProviderConfig,
  getBrowserProviderConfig,
  updateBrowserProviderConfig,
} from '@/lib/db';
import type { BrowserProviderConfigResponse, UpdateBrowserProviderConfigRequest } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const config = getBrowserProviderConfig(id);
  if (!config) {
    return NextResponse.json({ error: 'Browser provider config not found' }, { status: 404 });
  }
  return NextResponse.json<BrowserProviderConfigResponse>({ config });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json() as UpdateBrowserProviderConfigRequest;
    const config = updateBrowserProviderConfig(id, body);
    return NextResponse.json<BrowserProviderConfigResponse>({ config });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update browser provider',
        ...(error instanceof BrowserProviderInUseError ? { usage: error.usage } : {}),
      },
      { status: error instanceof BrowserProviderInUseError ? 409 : 400 },
    );
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    deleteBrowserProviderConfig(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete browser provider',
        ...(error instanceof BrowserProviderInUseError ? { usage: error.usage } : {}),
      },
      { status: error instanceof BrowserProviderInUseError ? 409 : 400 },
    );
  }
}
