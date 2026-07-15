// 团队出图回调端点:etsy-team-image stdio MCP 进程把 generate_image 调用转发到这里。
// 只做参数解析;配额/计费/生成/路径记录都在 team-image-service。

import { NextRequest, NextResponse } from 'next/server';
import { handleTeamImageCall } from '@/lib/etsy-forge/team/team-image-service';
import type { ImageGenArgs } from '@/lib/tools/image-gen-tool';

export const dynamic = 'force-dynamic';
// 单次出图 50-100s+,批量 count>1 更久;Next 默认超时会掐断长请求。
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  let body: { token?: unknown; args?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token || !body.args || typeof body.args !== 'object') {
    return NextResponse.json({ error: 'token and args are required' }, { status: 400 });
  }
  const result = await handleTeamImageCall(token, body.args as ImageGenArgs);
  return NextResponse.json(result);
}
