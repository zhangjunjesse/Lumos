import { NextRequest, NextResponse } from 'next/server';

import { ALL_STEPS, deleteRun, getRun, listSteps, updateRunCounters } from '@/lib/pinterest-radar/runs';
import { abortJob } from '@/lib/pinterest-radar/jobs';
import { markRunCancelled } from '@/lib/app/runtime/run-control';

const APP_ID = 'pinterest-radar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const steps = listSteps(id);
  return NextResponse.json({ run, steps });
}

/**
 * POST ?action=cancel — 停止 run 但保留运行历史(对比 DELETE 是真删)。
 * markRunCancelled + abortJob 所有 step + 标 run failed 写"用户手动取消"。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const action = url.searchParams.get('action') ?? '';
  if (action !== 'cancel') {
    return NextResponse.json({ error: 'action 必须是 cancel。' }, { status: 400 });
  }
  if (!getRun(id)) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  markRunCancelled(APP_ID, id);
  const aborted: string[] = [];
  for (const stepId of ALL_STEPS) {
    if (abortJob(id, stepId)) aborted.push(stepId);
  }
  updateRunCounters(id, { status: 'failed', failureReason: '用户手动取消。' });
  return NextResponse.json({ ok: true, aborted });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  // CLAUDE.md 任务生命周期规则:删除前必须取消所有 in-flight job
  // 先 markRunCancelled 让 worker 循环顶部 check 立刻退出
  markRunCancelled(APP_ID, id);
  const aborted: string[] = [];
  for (const stepId of ALL_STEPS) {
    if (abortJob(id, stepId)) aborted.push(stepId);
  }

  deleteRun(id);
  return NextResponse.json({ ok: true, aborted });
}
