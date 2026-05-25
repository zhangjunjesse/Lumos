import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

import { getRun } from '@/lib/etsy-erank/runs';
import { getDb } from '@/lib/db/connection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 诊断 ⑥ 数据 + 图片下载状况
// GET /api/apps/builtin/etsy-erank/runs/<id>/analyze/diag
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  const db = getDb();
  const rows = db.prepare(`SELECT keyword, listings_json FROM radar_ehunt WHERE run_id = ?`)
    .all(id) as Array<{ keyword: string; listings_json: string }>;

  const imgDir = path.resolve('public/etsy-images');
  const dirExists = fs.existsSync(imgDir);
  const dirFiles = dirExists ? fs.readdirSync(imgDir).length : 0;

  const summary = rows.map((r) => {
    const listings = JSON.parse(r.listings_json) as Array<Record<string, unknown>>;
    const sample = listings[0] ?? null;
    const ids = listings.map((l) => String(l.listing_id ?? '')).filter(Boolean);
    let onDisk = 0;
    let missing = 0;
    const sampleMissing: string[] = [];
    for (const id of ids) {
      if (fs.existsSync(path.join(imgDir, `${id}.jpg`))) onDisk++;
      else {
        missing++;
        if (sampleMissing.length < 5) sampleMissing.push(id);
      }
    }
    return {
      keyword: r.keyword,
      listingCount: listings.length,
      sampleListingFields: sample ? Object.keys(sample) : [],
      sampleImg: sample?.img ?? null,
      sampleImgUrl: sample?.img_url ?? null,
      onDisk,
      missing,
      sampleMissingIds: sampleMissing,
    };
  });

  return NextResponse.json({
    cwd: process.cwd(),
    imgDir,
    imgDirExists: dirExists,
    imgDirTotalFiles: dirFiles,
    keywords: summary,
  });
}
