import { NextRequest, NextResponse } from 'next/server';

import {
  SettingsValidationError,
  getWeChatAssistantSettings,
  updateWeChatAssistantSettings,
} from '@/lib/wechat-assistant/settings-store';
import { listTextGenProviderOptions } from '@/lib/wechat-assistant/provider-options';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = getWeChatAssistantSettings();
  const providers = listTextGenProviderOptions();
  return NextResponse.json({ settings, providers });
}

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const settings = updateWeChatAssistantSettings(body);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      return NextResponse.json(
        { error: 'invalid_settings', message: err.issues },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: 'internal_error', message }, { status: 500 });
  }
}
