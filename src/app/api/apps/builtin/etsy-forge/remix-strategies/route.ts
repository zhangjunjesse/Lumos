// 二创方向矩阵策略:GET 列(首次自动播种 A/B/C/D) / POST 新建 / PUT 改 / DELETE 删。供「设置→二创方向矩阵」管理 + 二创菜单读取。

import { NextRequest, NextResponse } from 'next/server';
import { listStrategies, createStrategy, updateStrategy, deleteStrategy } from '@/lib/etsy-forge/remix-strategies';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import type { RemixStrategyRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    return NextResponse.json({ strategies: listStrategies(store, getStorageUserId(req)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<RemixStrategyRow>;
    const store = getEtsyForgeStore();
    return NextResponse.json({ ok: true, strategy: createStrategy(store, getStorageUserId(req), body) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string } & Partial<RemixStrategyRow>;
    const id = (body.id ?? '').trim();
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    return NextResponse.json({ ok: updateStrategy(store, getStorageUserId(req), id, body) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    return NextResponse.json({ ok: deleteStrategy(store, getStorageUserId(req), id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
