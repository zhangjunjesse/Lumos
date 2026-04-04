import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getSession, updateSessionSystemPrompt } from '@/lib/db';
import { buildWorkflowChatSystemPrompt } from '@/lib/chat/workflow-session';

const requestSchema = z.object({
  sessionId: z.string(),
  workflowDsl: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { sessionId, workflowDsl } = requestSchema.parse(body);

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const dslJson = workflowDsl ? JSON.stringify(workflowDsl, null, 2) : undefined;
    const newPrompt = buildWorkflowChatSystemPrompt(dslJson);
    updateSessionSystemPrompt(sessionId, newPrompt);

    const updated = getSession(sessionId);
    return NextResponse.json({ session: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : '刷新工作流会话失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
