import { NextRequest, NextResponse } from 'next/server';

import { listLogs } from '@/lib/pinterest-radar/runs';
import type { StepId } from '@/lib/pinterest-radar/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const sinceTs = Number(url.searchParams.get('since')) || undefined;
  const stepId = (url.searchParams.get('step') as StepId | null) ?? undefined;
  const limit = Number(url.searchParams.get('limit')) || 500;
  const logs = listLogs(id, { stepId, sinceTs, limit });
  return NextResponse.json({ logs });
}
