import { NextResponse } from 'next/server';

import { listWeChatAutomationReports } from '@/lib/wechat-assistant/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const reports = await listWeChatAutomationReports();
  return NextResponse.json({ reports });
}
