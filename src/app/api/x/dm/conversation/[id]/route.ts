// GET /api/x/dm/conversation/[id]?maxId=&minId= — 读单个 X 私信会话的消息记录。只读。
import { NextRequest, NextResponse } from 'next/server';
import { getDmConversationView } from '@/lib/x-platform/dm';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';
import { isXReadTimeoutError } from '@/lib/x-platform/iterator-timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conversationId = (id || '').trim();
  if (!conversationId) return NextResponse.json({ ok: false, message: 'conversation id required' }, { status: 400 });

  const maxId = req.nextUrl.searchParams.get('maxId')?.trim() || undefined;
  const minId = req.nextUrl.searchParams.get('minId')?.trim() || undefined;
  try {
    const view = await getDmConversationView(conversationId, { maxId, minId });
    return NextResponse.json({ ok: true, ...view });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    if (isXReadTimeoutError(err)) {
      return NextResponse.json(
        { ok: false, code: 'X_READ_TIMEOUT', message: 'X 私信读取超时,请稍后重试或重新登录 X。' },
        { status: 504 },
      );
    }
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
