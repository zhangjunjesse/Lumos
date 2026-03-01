import { NextRequest, NextResponse } from 'next/server';
import { searchAll } from '@/lib/knowledge/searcher';

export async function POST(req: NextRequest) {
  const { query, top_k } = await req.json();
  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });
  try {
    const results = await searchAll(query, top_k || 5);
    return NextResponse.json(results);
  } catch (err) {
    console.error('[api/knowledge/search] Search failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
