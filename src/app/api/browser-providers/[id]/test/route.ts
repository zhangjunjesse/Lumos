import { NextRequest, NextResponse } from 'next/server';
import {
  getBrowserProviderConfigRaw,
  updateBrowserProviderTestResult,
} from '@/lib/db';
import { testBrowserProviderConfig } from '@/lib/browser-provider/testing';
import type { BrowserProviderTestResponse } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const raw = getBrowserProviderConfigRaw(id);
  if (!raw) {
    return NextResponse.json({ error: 'Browser provider config not found' }, { status: 404 });
  }

  const result = await testBrowserProviderConfig(raw);
  const config = updateBrowserProviderTestResult(id, {
    status: result.status,
    message: result.message,
    profileCount: result.profile_count,
  });
  const payload: BrowserProviderTestResponse = {
    ...result,
    config,
  };
  return NextResponse.json(payload, { status: result.ok ? 200 : 400 });
}
