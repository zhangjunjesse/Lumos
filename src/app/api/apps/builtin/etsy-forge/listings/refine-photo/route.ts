// 产品开发「图片」精修:POST {id, src, instruction} → 对某张商品图按指令再编辑(img2img)，异步出一张。

import { NextRequest, NextResponse } from 'next/server';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { getListing } from '@/lib/etsy-forge/listing/store';
import { resolveRefine, runPhotoGenJob } from '@/lib/etsy-forge/listing/photo-gen';
import { startPhotoJob } from '@/lib/etsy-forge/listing/photo-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; src?: string; instruction?: string };
    if (!body.id || !body.src) return NextResponse.json({ error: 'id 和 src 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const listing = getListing(store, userId, body.id);
    if (!listing) return NextResponse.json({ error: '产品不存在' }, { status: 404 });

    if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
      return NextResponse.json({ error: '未配置图片服务商（去「设置 → 图片生成」选一个支持图像编辑的服务商）' }, { status: 400 });
    }

    const spec = resolveRefine(body.src, body.instruction ?? '');
    const job = startPhotoJob(store, userId, body.id, spec.label);
    void runPhotoGenJob(store, job.id, spec.refs, spec.prompt).catch(() => {});

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
