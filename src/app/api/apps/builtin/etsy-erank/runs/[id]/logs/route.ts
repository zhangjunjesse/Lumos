import { NextRequest, NextResponse } from 'next/server';

import { getRun, listLogs } from '@/lib/etsy-erank/runs';
import type { StepId } from '@/lib/etsy-erank/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STEPS: StepId[] = ['huntground', 'seed', 'converge', 'verify', 'score', 'analyze', 'manual'];

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const url = new URL(req.url);
  const stepIdParam = url.searchParams.get('step');
  const sinceParam = url.searchParams.get('since');
  const stepId = stepIdParam && ALLOWED_STEPS.includes(stepIdParam as StepId) ? (stepIdParam as StepId) : undefined;
  const sinceTs = sinceParam ? Number(sinceParam) || undefined : undefined;
  const logs = listLogs(id, { stepId, sinceTs, limit: 500 });
  return NextResponse.json({ logs });
}
