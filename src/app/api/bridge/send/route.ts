import { NextRequest, NextResponse } from 'next/server';
import { feishuSend } from '@/lib/bridge/sync-helper';

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

    const result = await feishuSend({
      sessionId,
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
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Internal error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
