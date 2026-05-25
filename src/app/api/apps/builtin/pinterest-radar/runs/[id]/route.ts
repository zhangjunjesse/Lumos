import { NextRequest, NextResponse } from 'next/server';

import { ALL_STEPS, deleteRun, getRun, listSteps } from '@/lib/pinterest-radar/runs';
import { abortJob } from '@/lib/pinterest-radar/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const steps = listSteps(id);
  return NextResponse.json({ run, steps });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  // CLAUDE.md 任务生命周期规则:删除前必须取消所有 in-flight job
  // ALL_STEPS 遍历,abortJob 找不到 job 会返回 false,安全无副作用
  const aborted: string[] = [];
  for (const stepId of ALL_STEPS) {
    if (abortJob(id, stepId)) aborted.push(stepId);
  }

  deleteRun(id);
  return NextResponse.json({ ok: true, aborted });
}
