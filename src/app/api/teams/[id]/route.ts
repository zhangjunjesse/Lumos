// 平台团队单体:读 / 改 / 删。业务逻辑在 @/lib/team/store。

import { NextRequest, NextResponse } from 'next/server';
import { deleteTeam, getTeam, resolveTeamMembers, updateTeam } from '@/lib/team/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const team = getTeam(id);
  if (!team) return NextResponse.json({ error: '团队不存在' }, { status: 404 });
  return NextResponse.json({ team: { ...team, members: resolveTeamMembers(team) } });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const team = updateTeam(id, await request.json());
    return NextResponse.json({ team });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: msg === '团队不存在' ? 404 : 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ ok: deleteTeam(id) });
}
