import { z } from 'zod';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { createSession, getSession, getSetting, setSetting } from '@/lib/db';
import { dataDir } from '@/lib/db/connection';
import {
  buildWorkflowChatSessionBindingKey,
  buildWorkflowChatSystemPrompt,
  getWorkflowModel,
  getWorkflowProviderId,
  isWorkflowChatSession,
  WORKFLOW_CHAT_TITLE,
} from '@/lib/chat/workflow-session';

const postSchema = z.object({
  workflowId: z.string().min(1),
  workflowDsl: z.unknown().optional(),
});

/**
 * Look up the chat session bound to a workflow id. Binding lives in SQLite
 * settings, so it survives Electron port-fallback (per-origin localStorage
 * would not). Returns `{ session: null }` when no valid binding exists; the
 * client then POSTs to create one.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get('workflowId')?.trim() || '';
    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId required' }, { status: 400 });
    }

    const bindingKey = buildWorkflowChatSessionBindingKey(workflowId);
    const sessionId = (getSetting(bindingKey) || '').trim();
    if (!sessionId) {
      return NextResponse.json({ session: null });
    }

    const session = getSession(sessionId);
    if (!session || !isWorkflowChatSession(session)) {
      // Binding stale (session deleted or marker stripped); clear it so the
      // client falls through to create a fresh one.
      setSetting(bindingKey, '');
      return NextResponse.json({ session: null });
    }

    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : '查找工作流会话失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = postSchema.parse(body);

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
      'workflow',
    );

    setSetting(buildWorkflowChatSessionBindingKey(input.workflowId), session.id);

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建工作流会话失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
