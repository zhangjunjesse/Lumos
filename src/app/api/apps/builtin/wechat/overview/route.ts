import { NextResponse } from 'next/server';

import { loadWeChatOverview } from '@/lib/wechat-assistant/overview-loader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await loadWeChatOverview();
  if (!result.ready) {
    const status = result.reason === 'snapshot_failed' ? 500 : 200;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
