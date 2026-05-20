import { NextRequest, NextResponse } from 'next/server';

import {
  getResearchStore,
  listResearchReports,
} from '@/lib/ecommerce-assistant/research-storage';
import { startReport } from '@/lib/ecommerce-assistant/research-runner';
import { reconcileOrphans } from '@/lib/ecommerce-assistant/research-lifecycle';
import type { ResearchReportStatus } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUS: ResearchReportStatus[] = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
];

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const statusParam = url.searchParams.get('status');
    const platform = url.searchParams.get('platform') || undefined;
    const limitParam = url.searchParams.get('limit');
    const status = ALLOWED_STATUS.includes(statusParam as ResearchReportStatus)
      ? (statusParam as ResearchReportStatus)
      : undefined;
    const limit = limitParam ? Math.min(500, Math.max(1, Number(limitParam))) : undefined;
    // 自愈：把进程重启后残留的 queued/running zombie 行对账成终态，
    // 这样 UI 永远不会卡在「运行中」死态，无需全局启动钩子。
    reconcileOrphans();
    const reports = listResearchReports(getResearchStore(), {
      status,
      platform,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json({ reports });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      platform?: string;
      query?: string;
      instruction?: string;
      sources?: string[];
    };
    // 平台不再必填——写在 query（自然语言调研需求）里，SOP planner 自己抽。
    const platform = String(body.platform ?? '').trim();
    const query = String(body.query ?? '').trim();
    if (!query) {
      return NextResponse.json(
        { error: '必须提供调研需求描述（query）。' },
        { status: 400 },
      );
    }
    const sources = Array.isArray(body.sources)
      ? body.sources.map((s) => String(s).trim()).filter(Boolean)
      : undefined;
    const report = await startReport({
      platform,
      query,
      instruction: body.instruction?.trim() || null,
      sources,
    });
    return NextResponse.json({ report }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
