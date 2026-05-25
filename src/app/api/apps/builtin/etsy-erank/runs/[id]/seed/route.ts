import { NextRequest, NextResponse } from 'next/server';

import { getRun, appendLog, updateStep, updateRunCounters } from '@/lib/etsy-erank/runs';
import { registerJob, unregisterJob, getJob } from '@/lib/etsy-erank/jobs';
import { collectSeeds } from '@/lib/etsy-erank/seed-collector';
import { maybeCascadeNext } from '@/lib/etsy-erank/cascade';
import { getDb } from '@/lib/db/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const db = getDb();
  const rows = db
    .prepare(`SELECT source_tool, timeframe, rank, keyword, change_str, avg_searches, avg_ctr, competition, trend_note, category FROM radar_seeds WHERE run_id = ? ORDER BY source_tool, rank`)
    .all(id) as Array<{ source_tool: string; timeframe: string; rank: number | null; keyword: string; change_str: string; avg_searches: string; avg_ctr: string; competition: string; trend_note: string; category: string }>;
  return NextResponse.json({
    seeds: rows.map((r) => ({
      sourceTool: r.source_tool,
      timeframe: r.timeframe,
      rank: r.rank?.toString() ?? '',
      keyword: r.keyword,
      change: r.change_str,
      avgSearches: r.avg_searches,
      avgCtr: r.avg_ctr,
      competition: r.competition,
      trendNote: r.trend_note,
      category: r.category,
    })),
  });
}

interface SeedPostBody {
  timeframe?: string;
  limit?: number;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  if (getJob(id, 'seed')) {
    return NextResponse.json({ error: 'seed step is already running' }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as SeedPostBody;
  // 优先用 body 显式传的,否则用 run.config(创建时设的整轮默认)
  const timeframe = body.timeframe ?? run.config.seedTimeframe;
  const limit = Math.min(200, Math.max(10, body.limit ?? run.config.seedLimit));

  const ac = registerJob(id, 'seed');
  updateStep(id, 'seed', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });

  // 异步触发,API 立即返回 202
  (async () => {
    const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
      appendLog(id, 'seed', msg, level);
    };
    try {
      log(`▶ 启动 ② 市场热词 · timeframe=${timeframe} · limit=${limit}/源`);
      // 跑前清掉旧数据,避免重复
      const db = getDb();
      db.prepare('DELETE FROM radar_seeds WHERE run_id = ?').run(id);

      const result = await collectSeeds({
        runId: id,
        timeframe,
        limit,
        browserContextId: run.config.browserContextId,
        appendLog: log,
        isAborted: () => ac.signal.aborted,
      });

      updateStep(id, 'seed', { state: 'done', progressDone: result.totalInserted, progressTotal: result.totalInserted });
      updateRunCounters(id, { seedCount: result.totalInserted });
      log(`✓ ② 完成:Trend Buzz ${result.trendBuzzCount} + Monthly ${result.monthlyCount} = ${result.totalInserted} 个种子`);
      maybeCascadeNext(id, 'seed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ ${msg}`, 'error');
      updateStep(id, 'seed', { state: 'failed', errorMessage: msg });
    } finally {
      unregisterJob(id, 'seed');
    }
  })();

  return NextResponse.json({ accepted: true }, { status: 202 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id, 'seed');
  if (!job) return NextResponse.json({ ok: false, reason: 'no active job' });
  job.abortController.abort();
  return NextResponse.json({ ok: true });
}
