// T恤模板 CRUD(薄层,业务在 lib/etsy-forge/mockup-templates)。
// GET 列表(首次 seed 内置白/黑模板) / POST 上传底图新建 / PATCH 改名·框选·启停 / DELETE 删(内置不可删)。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from '@/lib/etsy-forge/mockup-templates';
import type { PrintArea } from '@/lib/image/compose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    return NextResponse.json({ templates: listTemplates(store, userId) });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; base_image_base64?: string; print_area?: PrintArea };
    if (!body.base_image_base64) return NextResponse.json({ error: '缺少底图' }, { status: 400 });
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const template = await createTemplate(store, userId, {
      name: body.name ?? '',
      baseImageBase64: body.base_image_base64,
      printArea: body.print_area,
    });
    return NextResponse.json({ ok: true, template });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; name?: string; print_area?: PrintArea; enabled?: boolean };
    if (!body.id) return NextResponse.json({ error: '缺少模板 id' }, { status: 400 });
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const template = updateTemplate(store, userId, body.id, {
      name: body.name,
      printArea: body.print_area,
      enabled: body.enabled,
    });
    return NextResponse.json({ ok: true, template });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: '缺少模板 id' }, { status: 400 });
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    deleteTemplate(store, userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 400 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
