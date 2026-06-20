// 产品开发「图片」按编辑后的提示词重生成:POST {id, prompt, role?, label?}
// → 用印花(design_src)作唯一真图参考 + 新 prompt 异步出一张新图;原图保留,新图进图库。

import { NextRequest, NextResponse } from 'next/server';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { getListing } from '@/lib/etsy-forge/listing/store';
import { runPhotoGenJob } from '@/lib/etsy-forge/listing/photo-gen';
import { startPhotoJob } from '@/lib/etsy-forge/listing/photo-jobs';
import type { PhotoRole } from '@/lib/etsy-forge/listing/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; prompt?: string; role?: PhotoRole; label?: string };
    const prompt = (body.prompt ?? '').trim();
    if (!body.id || !prompt) return NextResponse.json({ error: 'id 和 prompt 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const listing = getListing(store, userId, body.id);
    if (!listing) return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    const ref = listing.design_src || '';
    if (!ref) return NextResponse.json({ error: '该产品未设印花,无法重生成(印花是唯一真图参考)' }, { status: 400 });

    if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
      return NextResponse.json({ error: '未配置图片服务商（去「设置 → 图片生成」选一个）' }, { status: 400 });
    }

    const job = startPhotoJob(store, userId, body.id, body.label || '商品图', body.role, prompt);
    void runPhotoGenJob(store, job.id, [ref], prompt).catch(() => {});

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
