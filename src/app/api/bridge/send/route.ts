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
      return NextResponse.json(
        { error: result.error || 'SEND_FAILED', code: 'SEND_FAILED' },
        { status: 500 },
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

