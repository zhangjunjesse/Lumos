import { NextRequest, NextResponse } from 'next/server';

import { getRun, appendLog, updateStep, updateRunCounters } from '@/lib/etsy-erank/runs';
import { registerJob, unregisterJob, getJob } from '@/lib/etsy-erank/jobs';
import { expandAll } from '@/lib/etsy-erank/expander';
import { maybeCascadeNext } from '@/lib/etsy-erank/cascade';
import { getDb } from '@/lib/db/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const db = getDb();
  const groups = db
    .prepare(`SELECT seed, COUNT(*) as cnt FROM radar_expanded WHERE run_id = ? GROUP BY seed`)
    .all(id) as Array<{ seed: string; cnt: number }>;
  const expansions = groups.map((g) => {
    const rows = db
      .prepare(`SELECT keyword, sources_json FROM radar_expanded WHERE run_id = ? AND seed = ? ORDER BY keyword`)
      .all(id, g.seed) as Array<{ keyword: string; sources_json: string }>;
    return {
      seed: g.seed,
      keywords: rows.map((r) => ({ keyword: r.keyword, sources: JSON.parse(r.sources_json) as string[] })),
    };
  });
  return NextResponse.json({ expansions });
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (getJob(id, 'converge')) return NextResponse.json({ error: 'expand step already running' }, { status: 409 });

  const seedRow = getDb().prepare('SELECT COUNT(*) as cnt FROM radar_seeds WHERE run_id = ?').get(id) as { cnt: number };
  if (seedRow.cnt === 0) {
    return NextResponse.json({ error: '没有 ② 种子,先跑 ②' }, { status: 400 });
  }

  const ac = registerJob(id, 'converge');
  updateStep(id, 'converge', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });

  (async () => {
    const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(id, 'converge', msg, level);
    try {
      log('▶ 启动 ③ 扩词(收敛 + B 路 + C 路)');
      const result = await expandAll({
        runId: id,
        browserContextId: run.config.browserContextId,
        appendLog: log,
        isAborted: () => ac.signal.aborted,
        reportProgress: (done, total) => updateStep(id, 'converge', { progressDone: done, progressTotal: total }),
      });
      updateStep(id, 'converge', {
        state: 'done',
        progressDone: result.expandedTotal,
        progressTotal: result.expandedTotal,
        meta: {
          candidateCount: result.candidateCount,
          listingsTotal: result.listingsTotal,
          imagesDownloaded: result.imagesDownloaded,
        },
      });
      updateRunCounters(id, { convergeCount: result.expandedTotal });
      log(`✓ ③ 完成:候选 ${result.candidateCount} → 扩词 ${result.expandedTotal} · listing ${result.listingsTotal} · 图 ${result.imagesDownloaded}`);
      maybeCascadeNext(id, 'converge');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ ${msg}`, 'error');
      updateStep(id, 'converge', { state: 'failed', errorMessage: msg });
    } finally {
      unregisterJob(id, 'converge');
    }
  })();

  return NextResponse.json({ accepted: true }, { status: 202 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id, 'converge');
  if (!job) return NextResponse.json({ ok: false, reason: 'no active job' });
  job.abortController.abort();
  return NextResponse.json({ ok: true });
}
