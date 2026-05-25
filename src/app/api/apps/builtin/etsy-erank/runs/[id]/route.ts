import { NextRequest, NextResponse } from 'next/server';

import { deleteRun, getRun, listSteps, reconcileOrphanSteps } from '@/lib/etsy-erank/runs';
import { abortJob, listActiveJobs } from '@/lib/etsy-erank/jobs';
import { ALL_STEPS } from '@/lib/etsy-erank/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  // 自愈:进程重启后残留的 running step 重置为 failed,让用户能续跑
  const activeKeys = new Set(listActiveJobs().map((j) => `${j.runId}:${j.stepId}`));
  reconcileOrphanSteps(activeKeys);
  const steps = listSteps(id);
  return NextResponse.json({ run, steps });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  // 先 abort 所有这一轮的 in-flight job(SOP §5.1:不调 AdsPower stop,只 abort 我们自己的代码)
  for (const stepId of ALL_STEPS) abortJob(id, stepId);

  deleteRun(id);
  return NextResponse.json({ ok: true });
}
