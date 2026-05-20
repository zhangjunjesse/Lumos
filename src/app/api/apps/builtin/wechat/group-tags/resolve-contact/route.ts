import { NextRequest, NextResponse } from 'next/server';

import { queryWeChatApi } from '@/lib/wechat-export/api-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ResolveContactResponse {
  items?: { wxid: string; display: string; nickname: string; remark: string; has_remark: boolean }[];
  total?: number;
}

/**
 * GET ?q=刘总&limit=20 → search the FULL contact book (not just recent
 * sessions) for person candidates, so a group-tag member rule can pin the
 * exact wxid even when the user has no direct session with that person and
 * even when several contacts share a name (e.g. 3 个「刘总」). Backed by the
 * exporter `resolve_contact` op; this route only parses/forwards.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 20;
  if (!q) return NextResponse.json({ items: [], total: 0 });

  const res = await queryWeChatApi<ResolveContactResponse>('resolve_contact', { query: q, limit });
  if (!res.ok) {
    return NextResponse.json(
      { items: [], total: 0, error: res.error.code, message: res.error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ items: res.data.items ?? [], total: res.data.total ?? 0 });
}
