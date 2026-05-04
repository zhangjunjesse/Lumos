import { NextRequest } from 'next/server';
import { deleteSession, getSession, updateSessionWorkingDirectory, updateSessionTitle, updateSessionMode, updateSessionModel, updateSessionProviderId, updateSessionBrowserContext, updateSessionSystemPrompt, clearSessionMessages } from '@/lib/db';
import { cleanupSessionFeishuChat, syncSessionTitleToFeishu } from '@/lib/bridge/sync-helper';
import { validateBrowserContextId } from '@/lib/browser-provider/context-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    return Response.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get session';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const body = await request.json();

    if (body.working_directory) {
      updateSessionWorkingDirectory(id, body.working_directory);
    }
    if (body.title) {
      updateSessionTitle(id, body.title);
      // Best-effort: sync updated title to Feishu group name
      syncSessionTitleToFeishu(id, body.title).catch(err =>
        console.error('[Sync] Failed to update Feishu chat title:', err),
      );
    }
    if (body.mode) {
      updateSessionMode(id, body.mode);
    }
    if (body.provider_id) {
      updateSessionProviderId(id, body.provider_id);
    }
    if (typeof body.browser_context_id === 'string') {
      let browserContextId: string;
      try {
        browserContextId = validateBrowserContextId(body.browser_context_id);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : '浏览器上下文无效', code: 'INVALID_BROWSER_CONTEXT' },
          { status: 400 },
        );
      }
      updateSessionBrowserContext(id, browserContextId);
    }
    if (body.model) {
      updateSessionModel(id, body.model);
    }
    if (typeof body.system_prompt === 'string') {
      updateSessionSystemPrompt(id, body.system_prompt);
    }
    if (body.clear_messages) {
      clearSessionMessages(id);
    }

    const updated = getSession(id);
    return Response.json({ session: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update session';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const feishuCleanup = await cleanupSessionFeishuChat(id);
    deleteSession(id);
    return Response.json({
      success: true,
      feishu_cleanup: feishuCleanup,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete session';
    return Response.json({ error: message }, { status: 500 });
  }
}
