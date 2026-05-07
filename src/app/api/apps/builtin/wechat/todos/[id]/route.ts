import { NextResponse } from 'next/server';
import { z } from 'zod';

import { deleteTodo, updateTodoFollowup } from '@/lib/wechat-assistant/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  text: z.string().min(1).max(200).optional(),
  summary: z.string().max(1000).nullable().optional(),
  nextStep: z.string().max(500).nullable().optional(),
  followupType: z.enum(['reply', 'commitment', 'event', 'health', 'other']).nullable().optional(),
  dueAt: z.number().nullable().optional(),
  remindAt: z.number().nullable().optional(),
  involvedWxids: z.array(z.string().min(1).max(200)).max(20).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'empty_patch' });

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const todo = updateTodoFollowup(id, parsed.data);
  if (!todo) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ todo });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  const ok = deleteTodo(id);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
