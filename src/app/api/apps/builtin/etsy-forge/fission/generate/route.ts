// 裂变·出图:POST {product_id, base_ref, recipes, variants_per_recipe, stage, fission_run}。
// 同步校验(产品/服务商)后 fire-and-forget 生成;前端按 fission_run 轮询 listAssets 拉本轮结果。

import { NextRequest, NextResponse } from 'next/server';
import { runFissionGenerate } from '@/lib/etsy-forge/fission-generate';
import type { FissionStage } from '@/lib/etsy-forge/fission-mode';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ManualProductRow, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGES: FissionStage[] = ['preview', 'finalize', 'iterate'];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      product_id?: string;
      base_ref?: string;
      base_asset_id?: string;
      recipes?: string[][];
      variants_per_recipe?: number;
      stage?: string;
      fission_run?: string;
    };
    const productId = (body.product_id ?? '').trim();
    const baseRef = (body.base_ref ?? '').trim();
    const baseAssetId = (body.base_asset_id ?? '').trim();
    const fissionRun = (body.fission_run ?? '').trim();
    const stage = STAGES.includes(body.stage as FissionStage) ? (body.stage as FissionStage) : 'preview';
    const recipes = (Array.isArray(body.recipes) ? body.recipes : [])
      .filter((r) => Array.isArray(r))
      .map((r) => r.filter((c): c is string => typeof c === 'string' && !!c))
      .filter((r) => r.length > 0);
    const variantsPerRecipe = Math.max(1, Math.min(8, Math.floor(body.variants_per_recipe ?? 1)));
    if (!baseRef || !fissionRun) return NextResponse.json({ error: 'base_ref / fission_run 必填' }, { status: 400 });
    if (recipes.length === 0) return NextResponse.json({ error: '没有有效的方向配方' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    // productId 为空 = 「灵感」目标(无产品),结果作为新灵感图回流,不做产品校验。
    if (productId) {
      const isCollected = store.get<ProductRow>(COLLECTIONS.PRODUCTS, productId)?.user_id === userId;
      const isManual = store.get<ManualProductRow>(COLLECTIONS.MANUAL_PRODUCTS, productId)?.user_id === userId;
      if (!isCollected && !isManual) return NextResponse.json({ error: '目标产品不存在' }, { status: 404 });
    }
    if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
      return NextResponse.json({ error: '未配置图片服务商(去「设置 → 图片生成」选一个)' }, { status: 400 });
    }

    void runFissionGenerate(store, { userId, productId, baseRef, baseAssetId, recipes, variantsPerRecipe, stage, fissionRun }).catch(() => {});
    return NextResponse.json({ ok: true, started: recipes.length * variantsPerRecipe });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
