import { NextRequest, NextResponse } from 'next/server';
import * as tagStore from '@/lib/stores/tag-store';

type TagCategory = 'domain' | 'tech' | 'doctype' | 'project' | 'custom';
const VALID_CATEGORIES: ReadonlyArray<TagCategory> = ['domain', 'tech', 'doctype', 'project', 'custom'];

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const tag = tagStore.getTag(id);
  if (!tag) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(tag);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const current = tagStore.getTag(id);
  if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const updates: { name?: string; category?: TagCategory; color?: string } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    if (name.length > 30) return NextResponse.json({ error: 'name too long' }, { status: 400 });
    if (name !== current.name) {
      const dup = tagStore.getTagByName(name);
      if (dup && dup.id !== id) {
        return NextResponse.json(
          { error: 'duplicate', message: `已存在同名标签「${name}」,请改用「合并」` },
          { status: 409 },
        );
      }
      updates.name = name;
    }
  }

  if (body.category !== undefined) {
    if (typeof body.category !== 'string' || !VALID_CATEGORIES.includes(body.category as TagCategory)) {
      return NextResponse.json({ error: 'invalid category' }, { status: 400 });
    }
    updates.category = body.category as TagCategory;
  }

  if (body.color !== undefined) {
    if (typeof body.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
      return NextResponse.json({ error: 'invalid color' }, { status: 400 });
    }
    updates.color = body.color;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ tag: current });
  }

  const tag = tagStore.updateTag(id, updates);

  if (updates.name) {
    const itemIds = tagStore.getItemsByTag(id);
    tagStore.rebuildItemTagsJson(itemIds);
  }

  return NextResponse.json({ tag });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const current = tagStore.getTag(id);
  if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const itemIds = tagStore.getItemsByTag(id);
  const ok = tagStore.deleteTag(id);
  if (!ok) return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  tagStore.rebuildItemTagsJson(itemIds);
  return NextResponse.json({ ok: true, affected: itemIds.length });
}
