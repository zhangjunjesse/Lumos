// 单张素材重试：用它原来的来源图 + 该类生效 prompt 重新生成(同步，单张)。

import { NextRequest, NextResponse } from 'next/server';
import { retryAsset } from '@/lib/etsy-forge/asset-analyze';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type AssetRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { asset_id?: string };
    const id = (body.asset_id ?? '').trim();
    if (!id) return NextResponse.json({ error: 'asset_id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const asset = store.get<AssetRow>(COLLECTIONS.ASSETS, id);
    if (!asset || asset.user_id !== userId) return NextResponse.json({ error: '素材不存在' }, { status: 404 });

    // fire-and-forget：后台单跑(不和分析素材/抠姿势并发争服务商)，请求秒返回。前端轮询看结果。
    void retryAsset(store, { userId, assetId: id }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
