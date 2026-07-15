// 平台团队 CRUD:列表 + 创建。业务逻辑在 @/lib/team/store。

import { NextRequest, NextResponse } from 'next/server';
import { createTeam, listTeams, resolveTeamMembers } from '@/lib/team/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const teams = listTeams().map((t) => ({ ...t, members: resolveTeamMembers(t) }));
  return NextResponse.json({ teams });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const team = createTeam(body);
    return NextResponse.json({ team });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
