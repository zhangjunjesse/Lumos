import { NextRequest, NextResponse } from 'next/server';
import {
  createBrowserProviderConfig,
  listBrowserProviderConfigs,
} from '@/lib/db';
import type {
  BrowserProviderConfigResponse,
  BrowserProvidersResponse,
  CreateBrowserProviderConfigRequest,
} from '@/types';

export async function GET() {
  try {
    const payload: BrowserProvidersResponse = {
      embedded_context: {
        id: 'embedded:default',
        display_name: '内置浏览器',
        provider_type: 'embedded',
      },
      configs: listBrowserProviderConfigs(),
    };
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list browser providers' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as CreateBrowserProviderConfigRequest;
    const config = createBrowserProviderConfig(body);
    return NextResponse.json<BrowserProviderConfigResponse>({ config }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create browser provider' },
      { status: 400 },
    );
  }
}
