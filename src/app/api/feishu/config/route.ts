import { NextRequest, NextResponse } from 'next/server';
import { setSetting } from '@/lib/db';
import {
  DEFAULT_FEISHU_OAUTH_SCOPES,
  getFeishuCredentials,
  getFeishuOAuthScopes,
  getStoredFeishuSettings,
  isFeishuConfigured,
  maskSecret,
  resolveFeishuRedirectUri,
} from '@/lib/feishu-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function GET(request: NextRequest) {
  try {
    const stored = getStoredFeishuSettings();
    const credentials = getFeishuCredentials();

    return NextResponse.json({
      configured: isFeishuConfigured(),
      settings: {
        appId: stored.appId || credentials.appId,
        appSecret: maskSecret(stored.appSecret || credentials.appSecret),
        redirectUri: stored.redirectUri,
        oauthScopes: stored.oauthScopes || getFeishuOAuthScopes(),
      },
      effectiveRedirectUri: resolveFeishuRedirectUri(request.nextUrl.origin),
      defaults: {
        oauthScopes: DEFAULT_FEISHU_OAUTH_SCOPES,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load Feishu config';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const settings = body?.settings as Record<string, unknown> | undefined;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'Invalid settings payload' }, { status: 400 });
    }

    const current = getStoredFeishuSettings();
    const effective = getFeishuCredentials();
    const nextAppId = cleanValue(settings.appId);
    const nextAppSecret = cleanValue(settings.appSecret);
    const nextRedirectUri = cleanValue(settings.redirectUri);
    const nextOauthScopes = cleanValue(settings.oauthScopes);

    setSetting('feishu_app_id', nextAppId);
    setSetting(
      'feishu_app_secret',
      nextAppSecret.startsWith('***') ? (current.appSecret || effective.appSecret) : nextAppSecret,
    );
    setSetting('feishu_redirect_uri', nextRedirectUri);
    setSetting('feishu_oauth_scopes', nextOauthScopes);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save Feishu config';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
