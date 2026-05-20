import { NextRequest, NextResponse } from 'next/server';

import {
  getResearchReport,
  getResearchStore,
  readReportMarkdown,
} from '@/lib/ecommerce-assistant/research-storage';
import { deleteReportWithCancel } from '@/lib/ecommerce-assistant/research-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const store = getResearchStore();
    const report = getResearchReport(store, id);
    if (!report) return NextResponse.json({ error: '报告不存在。' }, { status: 404 });
    const url = new URL(req.url);
    const includeBody = url.searchParams.get('body') !== '0';
    const markdown = includeBody ? readReportMarkdown(id) : null;
    return NextResponse.json({ report, markdown });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    // 先取消正在运行的后台任务，再删可见记录与磁盘 md（CLAUDE.md 生命周期规则）。
    const ok = deleteReportWithCancel(id);
    if (!ok) return NextResponse.json({ error: '报告不存在或已被删除。' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
