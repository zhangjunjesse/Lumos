// 提示词库 CRUD（按分类）。5 类：cutout/scene/model/product/pose。
// 每类可多条，其中一条 is_default=true 为「当前生效」；自动任务读生效那条，没自定义时用内置默认。
// GET 列某类(含 is_default)并回传内置默认；POST 新建(首条或显式时设默认)；PATCH 改内容/设默认；DELETE 删除。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { DEFAULT_PROMPTS, PROMPT_CATEGORIES } from '@/lib/etsy-forge/prompt-defaults';
import { COLLECTIONS, type PromptCategory, type PromptRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isValidCategory = (c: string): c is PromptCategory => (PROMPT_CATEGORIES as string[]).includes(c);

// 取消某分类下其它「生效」标记（设默认前先清场，保证每类至多一条生效）。
function clearDefaults(store: ReturnType<typeof getEtsyForgeStore>, userId: string, category: string): void {
  const rows = store.query<PromptRow>(COLLECTIONS.PROMPTS, { filter: { user_id: userId, category }, limit: 500 });
  for (const r of rows) if (r.is_default) store.update<PromptRow>(COLLECTIONS.PROMPTS, r.id, { is_default: false });
}

export async function GET(req: NextRequest) {
  try {
    const category = new URL(req.url).searchParams.get('category') ?? 'cutout';
    if (!isValidCategory(category)) return NextResponse.json({ error: '无效分类' }, { status: 400 });
    const store = getEtsyForgeStore();
    const rows = store.query<PromptRow>(COLLECTIONS.PROMPTS, {
      filter: { user_id: getStorageUserId(req), category },
      orderBy: { field: 'created_at', direction: 'asc' },
      limit: 500,
    });
    return NextResponse.json({
      prompts: rows.map((r) => ({ id: r.id, category: r.category, name: r.name, content: r.content, is_default: !!r.is_default })),
      default_content: DEFAULT_PROMPTS[category],
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { category?: string; name?: string; content?: string; is_default?: boolean };
    const category = body.category ?? 'cutout';
    const name = (body.name ?? '').trim();
    const content = (body.content ?? '').trim();
    if (!isValidCategory(category)) return NextResponse.json({ error: '无效分类' }, { status: 400 });
    if (!name || !content) return NextResponse.json({ error: 'name 和 content 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const existing = store.query<PromptRow>(COLLECTIONS.PROMPTS, { filter: { user_id: userId, category }, limit: 500 });
    const makeDefault = body.is_default === true || existing.length === 0; // 首条自动生效
    if (makeDefault) clearDefaults(store, userId, category);
    const row = store.create(COLLECTIONS.PROMPTS, {
      user_id: userId,
      category,
      name: name.slice(0, 80),
      content: content.slice(0, 4000),
      is_default: makeDefault,
      created_at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; content?: string; is_default?: boolean };
    const id = (body.id ?? '').trim();
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const row = store.get<PromptRow>(COLLECTIONS.PROMPTS, id);
    if (!row || row.user_id !== userId) return NextResponse.json({ error: '提示词不存在' }, { status: 404 });

    const patch: Partial<PromptRow> = {};
    if (typeof body.content === 'string') patch.content = body.content.trim().slice(0, 4000);
    if (body.is_default === true) {
      clearDefaults(store, userId, row.category);
      patch.is_default = true;
    }
    store.update<PromptRow>(COLLECTIONS.PROMPTS, id, patch);
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
    const row = store.get<PromptRow>(COLLECTIONS.PROMPTS, id);
    if (!row || row.user_id !== userId) return NextResponse.json({ error: '提示词不存在' }, { status: 404 });
    const wasDefault = !!row.is_default;
    const ok = store.delete(COLLECTIONS.PROMPTS, id);
    // 删掉的是生效那条 → 把同类剩下的第一条顶上来，避免该类没有生效项
    if (ok && wasDefault) {
      const rest = store.query<PromptRow>(COLLECTIONS.PROMPTS, {
        filter: { user_id: userId, category: row.category },
        orderBy: { field: 'created_at', direction: 'asc' },
        limit: 1,
      });
      if (rest[0]) store.update<PromptRow>(COLLECTIONS.PROMPTS, rest[0].id, { is_default: true });
    }
    return NextResponse.json({ ok });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
