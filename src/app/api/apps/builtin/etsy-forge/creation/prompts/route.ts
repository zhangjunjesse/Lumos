// 创作助手「提示词模板」CRUD。用户自存常用提示词,跨会话/重启复用。
// 与 /api/apps/builtin/etsy-forge/prompts(分类化生图提示词库)分开,单独 collection。
// GET 列出当前用户全部模板;POST 新建{name,content};PATCH 改名/改内容{id,name?,content?};DELETE ?id= 删除。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type CreationPromptRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NAME_MAX = 80;
const CONTENT_MAX = 8000;
const MAX_TEMPLATES = 200;

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    const rows = store.query<CreationPromptRow>(COLLECTIONS.CREATION_PROMPTS, {
      filter: { user_id: getStorageUserId(req) },
      orderBy: { field: 'created_at', direction: 'desc' },
      limit: 500,
    });
    return NextResponse.json({
      templates: rows.map((r) => ({ id: r.id, name: r.name, content: r.content, created_at: r.created_at })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; content?: string };
    const name = (body.name ?? '').trim();
    const content = (body.content ?? '').trim();
    if (!name || !content) return NextResponse.json({ error: 'name 和 content 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    if (store.count(COLLECTIONS.CREATION_PROMPTS, { user_id: userId }) >= MAX_TEMPLATES) {
      return NextResponse.json({ error: `模板数量已达上限 ${MAX_TEMPLATES},请先删除一些` }, { status: 400 });
    }
    const row = store.create(COLLECTIONS.CREATION_PROMPTS, {
      user_id: userId,
      name: name.slice(0, NAME_MAX),
      content: content.slice(0, CONTENT_MAX),
      created_at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; name?: string; content?: string };
    const id = (body.id ?? '').trim();
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const row = store.get<CreationPromptRow>(COLLECTIONS.CREATION_PROMPTS, id);
    if (!row || row.user_id !== userId) return NextResponse.json({ error: '模板不存在' }, { status: 404 });

    const patch: Partial<CreationPromptRow> = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, NAME_MAX);
    if (typeof body.content === 'string' && body.content.trim()) patch.content = body.content.trim().slice(0, CONTENT_MAX);
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: '无可更新字段' }, { status: 400 });

    store.update<CreationPromptRow>(COLLECTIONS.CREATION_PROMPTS, id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const row = store.get<CreationPromptRow>(COLLECTIONS.CREATION_PROMPTS, id);
    if (!row || row.user_id !== userId) return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    return NextResponse.json({ ok: store.delete(COLLECTIONS.CREATION_PROMPTS, id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
