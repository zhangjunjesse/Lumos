import { NextRequest, NextResponse } from 'next/server';

import { getRun, appendLog, updateStep, updateRunCounters } from '@/lib/etsy-erank/runs';
import { registerJob, unregisterJob, getJob } from '@/lib/etsy-erank/jobs';
import { verifyBulk, countGrades } from '@/lib/etsy-erank/verifier';
import { maybeCascadeNext } from '@/lib/etsy-erank/cascade';
import { getDb } from '@/lib/db/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const db = getDb();
  const rows = db
    .prepare(`SELECT seed, keyword, sources_json, searches, clicks, ctr, competition, kd, google, grade FROM radar_bulk WHERE run_id = ? ORDER BY CASE grade WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END, keyword`)
    .all(id) as Array<{ seed: string; keyword: string; sources_json: string; searches: string; clicks: string; ctr: string; competition: string; kd: string; google: string; grade: string }>;
  const metrics = rows.map((r) => ({
    seed: r.seed,
    sources: JSON.parse(r.sources_json) as string[],
    keyword: r.keyword,
    searches: r.searches,
    clicks: r.clicks,
    ctr: r.ctr,
    competition: r.competition,
    kd: r.kd,
    google: r.google,
    grade: r.grade,
  }));
  return NextResponse.json({ metrics, gradeCounts: countGrades(id) });
}

interface VerifyPostBody {
  maxBatches?: number;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (getJob(id, 'verify')) return NextResponse.json({ error: 'verify step already running' }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as VerifyPostBody;
  const maxBatches = body.maxBatches && body.maxBatches > 0 ? Math.min(100, body.maxBatches) : run.config.verifyMaxBatches;

  const ac = registerJob(id, 'verify');
  updateStep(id, 'verify', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });

  (async () => {
    const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(id, 'verify', msg, level);
    try {
      log(`▶ 启动 ④ Bulk 验真 · 本次最多 ${maxBatches} 批`);
      const result = await verifyBulk({
        runId: id,
        maxBatches,
        browserContextId: run.config.browserContextId,
        appendLog: log,
        isAborted: () => ac.signal.aborted,
        reportProgress: (done, total) => updateStep(id, 'verify', { progressDone: done, progressTotal: total }),
      });
      const totalReal = result.gradeCounts.A + result.gradeCounts.B + result.gradeCounts.C;
      updateStep(id, 'verify', {
        state: 'done',
        progressDone: result.batchesRun,
        progressTotal: result.batchesRun,
        meta: { totalDone: result.totalDone, totalTodo: result.totalTodo, gradeCounts: result.gradeCounts },
      });
      updateRunCounters(id, {
        gradeA: result.gradeCounts.A,
        gradeB: result.gradeCounts.B,
        gradeC: result.gradeCounts.C,
      });
      log(`✓ ④ 完成本次 ${result.batchesRun} 批 · 累计 ${result.totalDone} 词 · 真候选 ${totalReal}(A ${result.gradeCounts.A} / B ${result.gradeCounts.B} / C ${result.gradeCounts.C} / drop ${result.gradeCounts.drop})`);
      if (result.totalTodo > 0) {
        log(`⏳ 还剩 ${result.totalTodo} 词未跑(配额耗尽或达到 maxBatches),明天可续跑`);
      }
      maybeCascadeNext(id, 'verify');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ ${msg}`, 'error');
      updateStep(id, 'verify', { state: 'failed', errorMessage: msg });
    } finally {
      unregisterJob(id, 'verify');
    }
  })();

  return NextResponse.json({ accepted: true }, { status: 202 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id, 'verify');
  if (!job) return NextResponse.json({ ok: false, reason: 'no active job' });
  job.abortController.abort();
  return NextResponse.json({ ok: true });
}
