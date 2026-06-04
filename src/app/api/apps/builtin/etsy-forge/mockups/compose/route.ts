// 「我的产品」内联生成:选参考图 + 提示词 → 图生图 → 挂到目标产品(采集 id 或手攒 id)下,新增一张。
// 快速校验(产品存在/服务商)同步报错;生成 fire-and-forget,前端轮询 listMockups 看新图。

import { NextRequest, NextResponse } from 'next/server';
import { runComposerGenerate } from '@/lib/etsy-forge/composer';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ManualProductRow, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_id?: string; references?: string[]; prompt?: string };
    const productId = (body.product_id ?? '').trim();
    const references = (Array.isArray(body.references) ? body.references : []).filter((x): x is string => typeof x === 'string' && !!x);
    const prompt = (body.prompt ?? '').trim();
    if (!productId) return NextResponse.json({ error: 'product_id 必填' }, { status: 400 });
    if (!prompt) return NextResponse.json({ error: '请输入提示词' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    // 目标产品必须是该用户的采集商品或手攒产品之一
    const isCollected = store.get<ProductRow>(COLLECTIONS.PRODUCTS, productId)?.user_id === userId;
    const isManual = store.get<ManualProductRow>(COLLECTIONS.MANUAL_PRODUCTS, productId)?.user_id === userId;
    if (!isCollected && !isManual) return NextResponse.json({ error: '目标产品不存在' }, { status: 404 });
    if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
      return NextResponse.json({ error: '未配置图片服务商(去「设置 → 图片生成」选一个)' }, { status: 400 });
    }

    void runComposerGenerate(store, { userId, productId, references, prompt }).catch(() => {});
    return NextResponse.json({ ok: true, started: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
