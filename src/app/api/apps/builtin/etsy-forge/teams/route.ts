// 出图团队 CRUD(薄层,业务在 lib/etsy-forge/team/team-store)。
// GET 列表(含按需 seed 默认团队) / POST 新建 / PATCH 改(含设默认) / DELETE 删。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { createTeam, deleteTeam, listTeams, updateTeam } from '@/lib/etsy-forge/team/team-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    return NextResponse.json({ teams: listTeams(store, userId) });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; description?: string; sop?: string; members?: unknown; images_per_run?: number };
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const team = createTeam(store, userId, { name: body.name ?? '', description: body.description, sop: body.sop, members: body.members, images_per_run: body.images_per_run });
    return NextResponse.json({ ok: true, team });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; name?: string; description?: string; sop?: string; members?: unknown; images_per_run?: number; is_default?: boolean };
    if (!body.id) return NextResponse.json({ error: '缺少团队 id' }, { status: 400 });
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const team = updateTeam(store, userId, body.id, body);
    return NextResponse.json({ ok: true, team });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: '缺少团队 id' }, { status: 400 });
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    deleteTeam(store, userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: msg(err) }, { status: 400 });
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
