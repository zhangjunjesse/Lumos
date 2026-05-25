import { NextRequest, NextResponse } from 'next/server';

import { getRun } from '@/lib/pinterest-radar/runs';
import { triggerStep } from '@/lib/pinterest-radar/cascade';
import { abortJob, getJob } from '@/lib/pinterest-radar/jobs';
import type { StepId } from '@/lib/pinterest-radar/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STEPS: StepId[] = ['huntground', 'collect', 'metrics', 'analyze', 'etsy_listings', 'report'];

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string; step: string }> }) {
  const { id, step } = await ctx.params;
  if (!VALID_STEPS.includes(step as StepId)) {
    return NextResponse.json({ error: `invalid step: ${step}` }, { status: 400 });
  }
  if (!getRun(id)) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (getJob(id, step as StepId)) {
    return NextResponse.json({ error: `step ${step} already running` }, { status: 409 });
  }

  // 异步触发,API 立即返回 202
  setImmediate(() => {
    triggerStep(id, step as StepId).catch(() => { /* error 已写日志 */ });
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; step: string }> }) {
  const { id, step } = await ctx.params;
  if (!VALID_STEPS.includes(step as StepId)) {
    return NextResponse.json({ error: `invalid step: ${step}` }, { status: 400 });
  }
  const aborted = abortJob(id, step as StepId);
  return NextResponse.json({ aborted });
}
