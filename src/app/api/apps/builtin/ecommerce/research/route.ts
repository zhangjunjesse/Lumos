import { NextRequest, NextResponse } from 'next/server';

import {
  getResearchStore,
  listResearchReports,
} from '@/lib/ecommerce-assistant/research-storage';
import { startReport } from '@/lib/ecommerce-assistant/research-runner';
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
    const platform = String(body.platform ?? '').trim();
    const query = String(body.query ?? '').trim();
    if (!platform) return NextResponse.json({ error: '必须提供 platform。' }, { status: 400 });
    if (!query) return NextResponse.json({ error: '必须提供 query。' }, { status: 400 });
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
