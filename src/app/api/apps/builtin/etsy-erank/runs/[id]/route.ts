import { NextRequest, NextResponse } from 'next/server';

import { deleteRun, getRun, listSteps, reconcileOrphanSteps, updateRunCounters } from '@/lib/etsy-erank/runs';
import { abortJob, listActiveJobs } from '@/lib/etsy-erank/jobs';
import { ALL_STEPS } from '@/lib/etsy-erank/types';
import { markRunCancelled } from '@/lib/app/runtime/run-control';

const APP_ID = 'etsy-erank';

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

/**
 * POST ?action=cancel — 停止当前 run 但保留运行历史。
 *
 * 先 markRunCancelled(协作式取消旗标, worker 循环顶部 check) +
 * abortJob 所有 step(per-step AbortController) + 标 run failed 写明 "用户手动取消"。
 * 不调 AdsPower stop, 不动浏览器登录态(SOP §5.1)。
 *
 * 跟 DELETE 的区别: 不删 db 记录, 用户能在"运行历史"里看到这条被手动取消的 run。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const action = url.searchParams.get('action') ?? '';
  if (action !== 'cancel') {
    return NextResponse.json({ error: 'action 必须是 cancel。' }, { status: 400 });
  }
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  markRunCancelled(APP_ID, id);
  for (const stepId of ALL_STEPS) abortJob(id, stepId);
  updateRunCounters(id, { status: 'failed', failureReason: '用户手动取消。' });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  // 先 markRunCancelled + abort 所有 in-flight job (SOP §5.1: 不调 AdsPower stop,
  // 只 abort 我们自己的代码)。worker 循环顶部 check 后立刻退出, 不再发新请求。
  markRunCancelled(APP_ID, id);
  for (const stepId of ALL_STEPS) abortJob(id, stepId);

  deleteRun(id);
  return NextResponse.json({ ok: true });
}
