// /api/apps/builtin/etsy-forge/collect-preview
// 最小验证入口：给关键词，走 AdsPower+Playwright 爬一页 Etsy 搜索结果，原样返回抓到的
// 商品（主图/url/价格 + EHunt 指标）+ ehuntStatus + warning。不入库，纯验证爬取核心 / 调选择器用。
// 浏览器上下文取 app_settings.browser_context_id（在设置→采集浏览器选）。

import { NextRequest, NextResponse } from 'next/server';
import { collectEtsyListings } from '@/lib/etsy-forge/product-collector';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { keyword?: string; maxProducts?: number };
    const keyword = (body.keyword ?? '').trim();
    if (!keyword) return NextResponse.json({ error: 'keyword 必填' }, { status: 400 });
    const maxProducts =
      typeof body.maxProducts === 'number' && body.maxProducts >= 1 && body.maxProducts <= 48
        ? Math.floor(body.maxProducts)
        : 12;

    const store = getEtsyForgeStore();
    const settings = store.query<{ browser_context_id?: string }>('app_settings', { limit: 1 })[0];
    const browserContextId = settings?.browser_context_id ?? 'embedded:default';

    const result = await collectEtsyListings({ keyword, maxProducts, browserContextId });
    return NextResponse.json({
      ...result,
      browserContextId,
      hint:
        result.products.length === 0
          ? '没抓到商品 — 多半是 Etsy 列表卡选择器需对真实页面调（[data-listing-id] / .v2-listing-card），或被反爬/登录墙。'
          : result.ehuntStatus !== 'ok'
            ? 'EHunt 指标没抓到 — 见 ehuntStatus / warning；商品主图应该是有的。'
            : '抓取正常。',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
