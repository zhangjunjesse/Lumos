import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  isWeChatAssistantTaskId,
  listWeChatAssistantTasks,
  updateWeChatAssistantTask,
} from '@/lib/wechat-assistant/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  id: z.string(),
  enabled: z.boolean().optional(),
  schedule: z.string().optional(),
});

export async function GET() {
  return NextResponse.json({ tasks: listWeChatAssistantTasks() });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success || !isWeChatAssistantTaskId(parsed.data.id)) {
    return NextResponse.json({ error: 'invalid_task' }, { status: 400 });
  }
  const tasks = updateWeChatAssistantTask(parsed.data.id, {
    enabled: parsed.data.enabled,
    schedule: parsed.data.schedule,
  });
  return NextResponse.json({ tasks });
}
