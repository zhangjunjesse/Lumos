import { type NextRequest, NextResponse } from 'next/server';

import { sendAppImNotification } from '@/lib/app/im-notifications';
import { getAppPlatformService } from '@/lib/app/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/apps/<id>/im/notify
 *
 * App-owned outbound notification bridge. It can notify the user over the
 * configured IM channel, but inbound user replies still route to Main Agent.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { db } = getAppPlatformService();
    const result = await sendAppImNotification({
      ...body,
      db,
      appId: id,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, status: 'failed', error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
