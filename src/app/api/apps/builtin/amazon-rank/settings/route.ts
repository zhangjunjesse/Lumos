import { NextRequest, NextResponse } from 'next/server';

import { getAmazonRankAppContext } from '@/lib/amazon-rank/app-store';
import {
  getRankSettings,
  getWatchlist,
  setRankSettings,
  setWatchlist,
} from '@/lib/amazon-rank/settings';
import type { RankSettings, RankWatchlist } from '@/lib/amazon-rank/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = getAmazonRankAppContext();
    return NextResponse.json({
      settings: getRankSettings(ctx.store),
      watchlist: getWatchlist(ctx.store),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = getAmazonRankAppContext();
    const body = (await req.json().catch(() => null)) as
      | { settings?: Partial<RankSettings>; watchlist?: RankWatchlist }
      | null;
    if (!body) return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });

    const settings = body.settings
      ? setRankSettings(ctx.store, body.settings)
      : getRankSettings(ctx.store);
    const watchlist = body.watchlist
      ? setWatchlist(ctx.store, body.watchlist)
      : getWatchlist(ctx.store);
    return NextResponse.json({ settings, watchlist });
  } catch (error) {
    return serverError(error);
  }
}

function serverError(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}
