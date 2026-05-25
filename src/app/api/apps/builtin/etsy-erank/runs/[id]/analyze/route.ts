import { NextRequest, NextResponse } from 'next/server';

import { getRun, appendLog, updateStep } from '@/lib/etsy-erank/runs';
import { registerJob, unregisterJob, getJob } from '@/lib/etsy-erank/jobs';
import { analyzeAllAGrade } from '@/lib/etsy-erank/analyzer';
import { getDb } from '@/lib/db/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const db = getDb();
  const rows = db.prepare(`SELECT keyword, analysis_json, listings_json FROM radar_ehunt WHERE run_id = ?`)
    .all(id) as Array<{ keyword: string; analysis_json: string; listings_json: string }>;
  const items = rows.map((r) => {
    const rawListings = JSON.parse(r.listings_json) as Array<Record<string, unknown>>;
    // 兼容老数据:之前 analyzer 直接存了 ListingItem(字段名 img_url / shop_text),
    // UI 期望 EhuntListing(字段名 img / shop_name)。统一在 API 层 transform。
    const listings = rawListings.map((l) => {
      const listingId = String(l.listing_id ?? '');
      const shopName = typeof l.shop_name === 'string' && l.shop_name
        ? (l.shop_name as string)
            .replace(/\s+Ad\s+from\s+shop\s+.+$/i, '')
            .replace(/\s+From\s+shop\s+.+$/i, '')
            .trim()
        : '';
      return {
        listing_id: listingId,
        title: l.title ?? '',
        // 优先用 l.img(新数据已是本地路径),fallback 用 listing_id 拼本地路径(旧数据)
        img: typeof l.img === 'string' && (l.img as string).startsWith('/') ? l.img : `/etsy-images/${listingId}.jpg`,
        price: l.price ?? '',
        shop_name: shopName,
        shop_rating: l.shop_rating ?? null,
        shop_review_count: l.shop_review_count ?? null,
        href: l.href ?? '',
        ehunt: l.ehunt ?? {},
      };
    });
    return {
      keyword: r.keyword,
      analysis: JSON.parse(r.analysis_json),
      listings,
    };
  });
  return NextResponse.json({ items });
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (getJob(id, 'analyze')) return NextResponse.json({ error: 'analyze step already running' }, { status: 409 });

  const ac = registerJob(id, 'analyze');
  updateStep(id, 'analyze', { state: 'running', progressDone: 0, progressTotal: 0, errorMessage: '' });

  (async () => {
    const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => appendLog(id, 'analyze', msg, level);
    try {
      log(`▶ 启动 ⑥ EHunt 商业分析`);
      const result = await analyzeAllAGrade({
        runId: id,
        browserContextId: run.config.browserContextId,
        appendLog: log,
        isAborted: () => ac.signal.aborted,
        reportProgress: (done, total) => updateStep(id, 'analyze', { progressDone: done, progressTotal: total }),
      });
      updateStep(id, 'analyze', {
        state: 'done',
        progressDone: result.keywordCount,
        progressTotal: result.keywordCount,
        meta: { succeed: result.succeed, failed: result.failed, imagesDownloaded: result.imagesDownloaded },
      });
      log(`✓ ⑥ 完成: ${result.succeed}/${result.keywordCount} 词 · 图 ${result.imagesDownloaded}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ ${msg}`, 'error');
      updateStep(id, 'analyze', { state: 'failed', errorMessage: msg });
    } finally {
      unregisterJob(id, 'analyze');
    }
  })();

  return NextResponse.json({ accepted: true }, { status: 202 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id, 'analyze');
  if (!job) return NextResponse.json({ ok: false, reason: 'no active job' });
  job.abortController.abort();
  return NextResponse.json({ ok: true });
}
