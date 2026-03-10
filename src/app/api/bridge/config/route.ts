import { NextResponse } from 'next/server';
import { getFeishuCredentials, isFeishuConfigured } from '@/lib/feishu-config';

export async function GET() {
  try {
    const { appId } = getFeishuCredentials();
    const configured = isFeishuConfigured();
    const maskedAppId = appId ? `${appId.slice(0, 6)}...${appId.slice(-4)}` : undefined;

    return NextResponse.json({ configured, appId: maskedAppId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read Feishu config';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
