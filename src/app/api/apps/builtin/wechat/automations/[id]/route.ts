import { NextResponse } from 'next/server';

import {
  deleteWeChatAutomation,
  triggerWeChatAutomation,
} from '@/lib/wechat-assistant/automations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
    const ok = await deleteWeChatAutomation(id);
    if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除失败';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
    const automation = await triggerWeChatAutomation(id);
    if (!automation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ automation, ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '触发失败';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
