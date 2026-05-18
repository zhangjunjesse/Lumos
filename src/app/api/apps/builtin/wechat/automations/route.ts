import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  createWeChatAutomation,
  ensureAutomationDslSchema,
  listWeChatAutomations,
  updateWeChatAutomation,
} from '@/lib/wechat-assistant/automations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('remind_followup'),
    followupId: z.string().min(1),
    messageTemplate: z.string().min(1).max(1000),
  }),
  z.object({
    kind: z.literal('recap_person'),
    personId: z.string().min(1),
    messageTemplate: z.string().min(1).max(1000),
  }),
  z.object({
    kind: z.literal('wechat_summary'),
    messageTemplate: z.string().min(1).max(1000),
  }),
  z.object({
    kind: z.literal('custom'),
    messageTemplate: z.string().min(1).max(1000),
  }),
]);

const draftSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['reminder_once', 'reminder_recurring']),
  cron: z.string().min(1).max(80),
  cronLabel: z.string().min(1).max(120),
  action: actionSchema,
  enabled: z.boolean(),
  lastRunAt: z.number().optional(),
  nextRunAt: z.number().optional(),
  followupId: z.string().optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  patch: draftSchema.partial().refine((value) => Object.keys(value).length > 0),
});

export async function GET() {
  await ensureAutomationDslSchema();
  return NextResponse.json({ automations: listWeChatAutomations() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_automation' }, { status: 400 });
  }
  const automation = await createWeChatAutomation(parsed.data);
  return NextResponse.json({ automation }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_automation' }, { status: 400 });
  }
  const automation = await updateWeChatAutomation(parsed.data.id, parsed.data.patch);
  if (!automation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ automation });
}
