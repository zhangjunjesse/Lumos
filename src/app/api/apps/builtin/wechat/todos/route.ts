import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  addManualTodo,
  listTodos,
  setTodoStatus,
} from '@/lib/wechat-assistant/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  const todos = status
    ? listTodos({ status: status as 'suggested' | 'open' | 'in_progress' | 'done' | 'dismissed' })
    : listTodos();
  return NextResponse.json({ todos });
}

const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('action'),
    id: z.string().min(1),
    action: z.enum(['confirm', 'start', 'done', 'dismiss', 'reopen']),
    dueAt: z.number().nullable().optional(),
    remindAt: z.number().nullable().optional(),
  }),
  z.object({
    kind: z.literal('manual'),
    text: z.string().min(1).max(200),
    sourceWxid: z.string().max(200).nullable().optional(),
    sourceDisplay: z.string().max(200).nullable().optional(),
    involvedWxids: z.array(z.string().min(1).max(200)).max(20).optional(),
    summary: z.string().max(1000).optional(),
    nextStep: z.string().max(500).optional(),
    followupType: z.enum(['reply', 'commitment', 'event', 'health', 'other']).optional(),
    byWhenText: z.string().max(40).optional(),
    dueAt: z.number().nullable().optional(),
    remindAt: z.number().nullable().optional(),
  }),
]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  if (parsed.data.kind === 'manual') {
    const todo = addManualTodo({
      text: parsed.data.text,
      sourceWxid: parsed.data.sourceWxid ?? null,
      sourceDisplay: parsed.data.sourceDisplay ?? null,
      involvedWxids: parsed.data.involvedWxids ?? [],
      summary: parsed.data.summary ?? null,
      nextStep: parsed.data.nextStep ?? null,
      followupType: parsed.data.followupType ?? 'other',
      byWhenText: parsed.data.byWhenText ?? null,
      dueAt: parsed.data.dueAt ?? null,
      remindAt: parsed.data.remindAt ?? null,
    });
    return NextResponse.json({ todo });
  }

  const targetStatus =
    parsed.data.action === 'confirm'
      ? 'open'
      : parsed.data.action === 'start'
        ? 'in_progress'
      : parsed.data.action === 'done'
        ? 'done'
        : parsed.data.action === 'reopen'
          ? 'open'
          : 'dismissed';
  const todo = setTodoStatus(parsed.data.id, targetStatus, {
    dueAt: parsed.data.dueAt ?? null,
    remindAt: parsed.data.remindAt ?? null,
  });
  if (!todo) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ todo });
}
