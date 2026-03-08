import { NextRequest, NextResponse } from 'next/server';
import { searchWithMeta } from '@/lib/knowledge/searcher';
import type { SearchOptions } from '@/lib/knowledge/types';

export async function POST(req: NextRequest) {
  const { query, top_k, mode, with_meta, disable_rewrite } = await req.json();
  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });
  try {
    const options: SearchOptions = {
      topK: Number(top_k || 5),
      retrievalMode: mode === 'enhanced' ? 'enhanced' : mode === 'reference' ? 'reference' : undefined,
      disableRewrite: Boolean(disable_rewrite),
    };
    const run = await searchWithMeta(query, options);
    if (with_meta) {
      return NextResponse.json(run);
    }
    return NextResponse.json(run.results);
  } catch (err) {
    console.error('[api/knowledge/search] Search failed:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
