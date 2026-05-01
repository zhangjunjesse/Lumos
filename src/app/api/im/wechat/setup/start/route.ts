/**
 * POST /api/im/wechat/setup/start
 *
 * 启动微信扫码绑定流程：调 ilink get_bot_qrcode 拿二维码。
 * 返回 { qrUrl, qrKey }，UI 展示 QR 让用户扫码，再轮询 /poll。
 *
 * Body (optional): { apiBase?: string, botType?: string, routeTag?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchBotQRCode } from '@/lib/im/providers/wechat/setup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { apiBase?: string; botType?: string; routeTag?: string } = {};
  try {
    if (req.headers.get('content-length')) {
      body = (await req.json()) as typeof body;
    }
  } catch {
    body = {};
  }

  try {
    const payload = await fetchBotQRCode({
      apiBase: body.apiBase,
      botType: body.botType,
      routeTag: body.routeTag,
    });
    return NextResponse.json({
      qrUrl: payload.qrcode_img_content,
      qrKey: payload.qrcode,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch QR failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
