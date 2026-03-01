import { NextRequest, NextResponse } from 'next/server';
import * as tagStore from '@/lib/stores/tag-store';

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get('category') as tagStore.TagCategory | null;
  const tags = tagStore.listTags(category ? { category } : undefined);
  return NextResponse.json(tags);
}

export async function POST(req: NextRequest) {
  const { name, category, color } = await req.json();
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  const existing = tagStore.getTagByName(name);
  if (existing) {
    return NextResponse.json({ error: 'Tag already exists' }, { status: 409 });
  }
  const tag = tagStore.createTag(name, { category, color });
  return NextResponse.json(tag);
}
