// 产品合成(带印花平铺 T)：POST 发起 inpaint(后台跑) / GET 列结果 / DELETE 删除。
// 印花来源既可本地路径(素材库印花)又可 url(灵感二创图)；产品图来自素材库 product 类。

import { NextRequest, NextResponse } from 'next/server';
import { prepareMerge, mergeOneProduct } from '@/lib/etsy-forge/product-merge';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type MockupRow, type ProductRow } from '@/lib/etsy-forge/types';
import { getImageConcurrency, mapLimit } from '@/lib/etsy-forge/concurrency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 把溯源引用变成可显示链接:已是 url(/api/ 或 http) 直接用,否则当本地路径走 media serve。
function toServable(ref?: string): string | null {
  if (!ref) return null;
  if (ref.startsWith('/api/') || ref.includes('://')) return ref;
  return `/api/media/serve?path=${encodeURIComponent(ref)}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      design?: { path?: string; url?: string; label?: string; source_product_id?: string };
      product_asset_ids?: string[];
    };
    const productAssetIds = Array.isArray(body.product_asset_ids)
      ? body.product_asset_ids.filter((x) => typeof x === 'string')
      : [];
    let localPath = body.design?.path?.trim();
    const url = body.design?.url?.trim() || (localPath ? `/api/media/serve?path=${encodeURIComponent(localPath)}` : '');
    if (!url && !localPath) return NextResponse.json({ error: '没选印花' }, { status: 400 });
    if (productAssetIds.length === 0) return NextResponse.json({ error: '没选产品图' }, { status: 400 });
    // 灵感二创图传的是相对 serve url，本地路径就嵌在 ?path= 里。服务端 fetch 不了相对 URL，
    // 把 path 抠出来直接读本地文件(只有 direct http 直链才回退 fetch url)。
    if (!localPath && url.startsWith('/api/media/serve')) {
      try {
        localPath = new URL(url, 'http://localhost').searchParams.get('path') || undefined;
      } catch {
        /* 解析失败就保留 url 走 fetch */
      }
    }

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const design = { localPath, url, label: body.design?.label, sourceProductId: body.design?.source_product_id };

    // 前置同步：服务商/印花读取错误立即报给前端(不吞)。
    const prep = await prepareMerge(store, userId, design);
    if ('error' in prep) return NextResponse.json({ error: prep.error }, { status: 500 });

    // 生成 fire-and-forget：请求秒返回，每张各自后台跑完落库；多张有限并发(并发度来自设置)。前端轮询 GET 看新图。
    void mapLimit(productAssetIds, getImageConcurrency(store), (pid) => mergeOneProduct(store, userId, design, prep, pid)).catch(() => {});

    return NextResponse.json({ ok: true, started: productAssetIds.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    const rows = store.query<MockupRow>(COLLECTIONS.MOCKUPS, {
      filter: { user_id: getStorageUserId(req) },
      orderBy: { field: 'created_at', direction: 'desc' },
      limit: 2000,
    });
    return NextResponse.json({
      mockups: rows.map((r) => {
        // 溯源:这张带印花 T 用的印花(design_ref) + 它最初来自哪个采集的 Etsy 商品(source_product_id → 主图+标题)。
        const srcProduct = r.source_product_id ? store.get<ProductRow>(COLLECTIONS.PRODUCTS, r.source_product_id) : null;
        return {
          id: r.id,
          url: r.image_path ? `/api/media/serve?path=${encodeURIComponent(r.image_path)}` : null,
          design_label: r.design_label ?? '',
          design_url: toServable(typeof r.design_ref === 'string' ? r.design_ref : undefined),
          source_product_id: r.source_product_id ?? null,
          source_product_title: srcProduct?.title ?? null,
          source_product_image: srcProduct?.main_image_url ?? null,
          source_product_url: srcProduct?.url ?? null,
          status: r.status,
          failure_reason: r.failure_reason ?? null,
          created_at: r.created_at,
        };
      }),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    const row = store.get<MockupRow>(COLLECTIONS.MOCKUPS, id);
    if (!row || row.user_id !== getStorageUserId(req)) {
      return NextResponse.json({ error: '不存在' }, { status: 404 });
    }
    return NextResponse.json({ ok: store.delete(COLLECTIONS.MOCKUPS, id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
