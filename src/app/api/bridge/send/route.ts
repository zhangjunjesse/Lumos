import { NextRequest, NextResponse } from 'next/server';
import { getBridgeService } from '@/lib/bridge/app/bridge-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, mode = 'text', content, mediaIds } = body || {};

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId required', code: 'MISSING_PARAMETER' },
        { status: 400 },
      );
    }

    const bridgeService = getBridgeService();
    const result = await bridgeService.sendMessage({
      sessionId,
      platform: 'feishu',
      mode,
      content,
      mediaIds,
    });

    if (!result.ok) {
      const errorCode = result.error || 'SEND_FAILED';
      const status =
        errorCode === 'FEISHU_AUTH_REQUIRED' ||
        errorCode === 'FEISHU_AUTH_EXPIRED' ||
        errorCode === 'FEISHU_USER_INFO_MISSING'
          ? 401
          : errorCode === 'EMPTY_CONTENT' || errorCode === 'EMPTY_MEDIA'
            ? 400
            : 500;
      return NextResponse.json(
        { error: errorCode, code: errorCode },
        { status },
      );
    }

    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json(
      { error: message, code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

