import { NextRequest } from 'next/server';
import { deleteSession, getSession, setSessionTeam, updateSdkSessionId, updateSessionWorkingDirectory, updateSessionTitle, updateSessionMode, updateSessionModel, updateSessionProviderId, updateSessionImageProviderId, updateSessionBrowserContext, updateSessionKnowledgeOptions, updateSessionSystemPrompt, clearSessionMessages } from '@/lib/db';
import { getTeam } from '@/lib/team/store';
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
    // 会话级图片服务商;允许传空串清除(回退全局默认),故用 !== undefined
    if (typeof body.image_provider_id === 'string') {
      updateSessionImageProviderId(id, body.image_provider_id);
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
    if (typeof body.knowledge_enabled === 'boolean') {
      updateSessionKnowledgeOptions(id, {
        enabled: body.knowledge_enabled,
        tagIds: Array.isArray(body.knowledge_tag_ids)
          ? body.knowledge_tag_ids.map((tagId: unknown) => String(tagId).trim()).filter(Boolean)
          : [],
        overrides: body.knowledge_overrides && typeof body.knowledge_overrides === 'object'
          ? body.knowledge_overrides
          : undefined,
      });
    }
    if (typeof body.system_prompt === 'string') {
      updateSessionSystemPrompt(id, body.system_prompt);
    }
    // 团队绑定随时可改(用户拍板):每条消息按发送时刻绑定的团队执行。
    // 换队(团队↔普通、A↔B)时清掉 SDK 会话 id——两种模式的装配(agents/bypass vs
    // canUseTool)不兼容,续用旧 SDK 会话会报错;清掉让下一轮起新会话、带 DB 历史续上。
    if (typeof body.team_id === 'string') {
      const teamId = body.team_id.trim();
      if (teamId && !getTeam(teamId)) {
        return Response.json({ error: '团队不存在', code: 'INVALID_TEAM' }, { status: 400 });
      }
      if ((session.team_id || '') !== teamId) {
        updateSdkSessionId(id, '');
      }
      setSessionTeam(id, teamId);
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
