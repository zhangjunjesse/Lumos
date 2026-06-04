// 裂变·方向库:GET 列(首次自动播种 35 个) / POST 新建 / PUT 改 / DELETE 删。供「方向库管理」UI 用。

import { NextRequest, NextResponse } from 'next/server';
import { listDirections, createDirection, updateDirection, deleteDirection } from '@/lib/etsy-forge/remix-directions';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import type { RemixDirectionRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    return NextResponse.json({ directions: listDirections(store, getStorageUserId(req)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<RemixDirectionRow>;
    const store = getEtsyForgeStore();
    return NextResponse.json({ ok: true, direction: createDirection(store, getStorageUserId(req), body) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string } & Partial<RemixDirectionRow>;
    const id = (body.id ?? '').trim();
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    return NextResponse.json({ ok: updateDirection(store, getStorageUserId(req), id, body) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    return NextResponse.json({ ok: deleteDirection(store, getStorageUserId(req), id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
