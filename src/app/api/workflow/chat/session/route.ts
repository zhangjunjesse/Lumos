import { z } from 'zod';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/db';
import { dataDir } from '@/lib/db/connection';
import {
  buildWorkflowChatSystemPrompt,
  getWorkflowModel,
  getWorkflowProviderId,
  WORKFLOW_CHAT_TITLE,
} from '@/lib/chat/workflow-session';

const requestSchema = z.object({
  workflowDsl: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = requestSchema.parse(body);

    await fs.mkdir(dataDir, { recursive: true });

    const dslJson = input.workflowDsl
      ? JSON.stringify(input.workflowDsl, null, 2)
      : undefined;

    const session = createSession(
      WORKFLOW_CHAT_TITLE,
      getWorkflowModel(),
      buildWorkflowChatSystemPrompt(dslJson),
      dataDir,
      'code',
      undefined,
      getWorkflowProviderId(),
    );

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建工作流会话失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
