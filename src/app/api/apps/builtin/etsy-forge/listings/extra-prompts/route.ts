// 「额外要求」常用库:GET 列出 / POST 保存 / DELETE 删除。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { createExtraPrompt, deleteExtraPrompt, listExtraPrompts } from '@/lib/etsy-forge/listing/extra-prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    return NextResponse.json({ prompts: listExtraPrompts(store, getStorageUserId(req)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { text?: string };
    const store = getEtsyForgeStore();
    const row = createExtraPrompt(store, getStorageUserId(req), body.text ?? '');
    if (!row) return NextResponse.json({ error: '内容为空' }, { status: 400 });
    return NextResponse.json({ ok: true, prompt: row });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    return NextResponse.json({ ok: deleteExtraPrompt(store, getStorageUserId(req), id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
