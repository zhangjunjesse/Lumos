// Midjourney 后续操作的回调端点:midjourney stdio MCP 进程把工具调用转发到这里。
// 只做参数解析;服务商解析/计费/执行/落库都在 @/lib/midjourney/service。

import { NextRequest, NextResponse } from 'next/server';
import { handleMidjourneyCall, type MidjourneyCallParams } from '@/lib/midjourney/service';

export const dynamic = 'force-dynamic';
// 局部重绘实测 90s,relax 模式排队更久;Next 默认超时会掐断长请求。
export const maxDuration = 900;

export async function POST(request: NextRequest) {
  let body: { action?: unknown; [key: string]: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : '';
  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }

  try {
    const { action: _omit, ...params } = body;
    const result = await handleMidjourneyCall(action, params as MidjourneyCallParams);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/midjourney] failed:', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
