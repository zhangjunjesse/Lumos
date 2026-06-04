// 重试合成:用当前图片服务商对某张 mockup 重新合成、覆盖原记录。
// 快速校验(服务商/记录存在)同步报错;实际合成 fire-and-forget,前端轮询 listMockups 看这张换图。

import { NextRequest, NextResponse } from 'next/server';
import { retryMockup } from '@/lib/etsy-forge/product-merge';
import { retryComposerMockup } from '@/lib/etsy-forge/composer';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type MockupRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { mockup_id?: string };
    const mockupId = (body.mockup_id ?? '').trim();
    if (!mockupId) return NextResponse.json({ error: 'mockup_id 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const m = store.get<MockupRow>(COLLECTIONS.MOCKUPS, mockupId);
    if (!m || m.user_id !== userId) return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
      return NextResponse.json({ error: '未配置图片服务商(去「设置 → 图片生成」选一个)' }, { status: 400 });
    }

    // fire-and-forget:合成慢(最长 10min),请求秒返回,前端轮询 listMockups 看这张换图。
    // 有 product_asset_id = SOP 合成(印花×空白T) → 重合成;否则是内联生成(composer) → 用原参考图+提示词重生成。
    if (m.product_asset_id) void retryMockup(store, userId, mockupId).catch(() => {});
    else void retryComposerMockup(store, userId, m).catch(() => {});
    return NextResponse.json({ ok: true, started: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
