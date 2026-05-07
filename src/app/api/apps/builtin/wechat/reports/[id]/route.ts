import { NextResponse } from 'next/server';

import { deleteArchivedWeChatAutomationReport } from '@/lib/wechat-assistant/report-archive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const deleted = deleteArchivedWeChatAutomationReport(id, { tombstoneMissing: true });
  if (!deleted) {
    return NextResponse.json({ error: 'report_not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
