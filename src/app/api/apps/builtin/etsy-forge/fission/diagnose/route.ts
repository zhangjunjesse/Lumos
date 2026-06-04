// 裂变·诊断:POST {base_ref} → 看图给 强项/80分综合征/库内推荐方向。同步返回(一次 vision 调用,不长)。

import { NextRequest, NextResponse } from 'next/server';
import { diagnoseForFission } from '@/lib/etsy-forge/fission-diagnose';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { base_ref?: string; base_asset_id?: string; force?: boolean };
    const baseRef = (body.base_ref ?? '').trim();
    const baseAssetId = (body.base_asset_id ?? '').trim();
    if (!baseRef) return NextResponse.json({ error: 'base_ref 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    const diagnosis = await diagnoseForFission(store, getStorageUserId(req), baseRef, baseAssetId, !!body.force);
    return NextResponse.json({ diagnosis });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
