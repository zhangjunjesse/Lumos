import { NextRequest, NextResponse } from 'next/server';
import { searchMessages } from '@/lib/goofish/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/goofish/search?q=KEYWORD&limit=N
 *
 * Searches the local archive (goofish_msgs_fts via FTS5, falling back to
 * LIKE if FTS isn't available) for messages containing the keyword.
 * Each hit comes back with peer + item context joined from the session table.
 *
 * Designed for AI agents and the panel's search box. Sub-millisecond when
 * the archive is populated; depends on /api/goofish/sync having run.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  const limit = Math.max(1, Math.min(200, Number(req.nextUrl.searchParams.get('limit')) || 50));
  if (!q) {
    return NextResponse.json({ ok: false, message: 'q is required' }, { status: 400 });
  }
  try {
    const account = req.nextUrl.searchParams.get('account') || '';
    const accountUnb = account && account !== 'all' ? account : undefined;
    const hits = searchMessages(q, { accountUnb, limit });
    // Group by cid so the AI gets one entry per buyer with the matching messages.
    type Group = {
      cid: string;
      peer_nick: string;
      peer_user_id: string;
      item_title: string;
      item_id: string;
      hits: Array<{ message_id: string; from_user_id: string; from_user_name: string; created_at: number; content_text: string }>;
    };
    const groups = new Map<string, Group>();
    for (const h of hits) {
      const g = groups.get(h.cid) ?? {
        cid: h.cid,
        peer_nick: h.peer_nick,
        peer_user_id: h.peer_user_id,
        item_title: h.item_title,
        item_id: h.item_id,
        hits: [],
      };
      g.hits.push({
        message_id: h.message_id,
        from_user_id: h.from_user_id,
        from_user_name: h.from_user_name,
        created_at: h.created_at,
        content_text: h.content_text,
      });
      groups.set(h.cid, g);
    }
    return NextResponse.json({ ok: true, q, total: hits.length, results: Array.from(groups.values()) });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

