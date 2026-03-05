import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;

    const configured = !!(appId && appSecret);
    const maskedAppId = appId ? `${appId.slice(0, 6)}...${appId.slice(-4)}` : undefined;

    return NextResponse.json({ configured, appId: maskedAppId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
