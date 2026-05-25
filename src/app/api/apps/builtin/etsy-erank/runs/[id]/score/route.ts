import { NextRequest, NextResponse } from 'next/server';

import { getRun, appendLog, updateStep } from '@/lib/etsy-erank/runs';
import { registerJob, unregisterJob, getJob } from '@/lib/etsy-erank/jobs';
import { scoreNiches } from '@/lib/etsy-erank/scorer';
import { maybeCascadeNext } from '@/lib/etsy-erank/cascade';
import { getDb } from '@/lib/db/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const db = getDb();
  const rows = db
    .prepare(`SELECT seed, niche_summary, niche_risks_json, candidates_json, stats_json FROM radar_scored_niches WHERE run_id = ?`)
    .all(id) as Array<{ seed: string; niche_summary: string; niche_risks_json: string; candidates_json: string; stats_json: string }>;
  const scoredNiches = rows.map((r) => ({
    seed: r.seed,
    niche_summary: r.niche_summary,
    niche_risks: JSON.parse(r.niche_risks_json) as string[],
    candidates: JSON.parse(r.candidates_json) as unknown[],
    stats: JSON.parse(r.stats_json) as unknown,
  }));
  return NextResponse.json({ scoredNiches });
}

interface ScorePostBody {
  userDirection?: string[];
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (getJob(id, 'score')) return NextResponse.json({ error: 'score step already running' }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as ScorePostBody;
  const userDirection = body.userDirection ?? run.capabilities;

  const ac = registerJob(id, 'score');
  updateStep(id, 'score', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });

  (async () => {
    const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(id, 'score', msg, level);
    try {
      log(`▶ 启动 ⑤ AI 解读`);
      const result = await scoreNiches({
        runId: id,
        userDirection,
        appendLog: log,
        isAborted: () => ac.signal.aborted,
        reportProgress: (done, total) => updateStep(id, 'score', { progressDone: done, progressTotal: total }),
      });
      updateStep(id, 'score', {
        state: 'done',
        progressDone: result.nicheCount,
        progressTotal: result.nicheCount,
        meta: { scored: result.scored, cached: result.cached, failed: result.failed },
      });
      log(`✓ ⑤ 完成: ${result.scored} 个新解读 · ${result.cached} 缓存命中 · ${result.failed} 失败`);
      maybeCascadeNext(id, 'score');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ ${msg}`, 'error');
      updateStep(id, 'score', { state: 'failed', errorMessage: msg });
    } finally {
      unregisterJob(id, 'score');
    }
  })();

  return NextResponse.json({ accepted: true }, { status: 202 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id, 'score');
  if (!job) return NextResponse.json({ ok: false, reason: 'no active job' });
  job.abortController.abort();
  return NextResponse.json({ ok: true });
}
