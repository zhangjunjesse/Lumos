import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { getAllSessions, createSession, getSession, setSessionTeam, updateSessionBrowserContext } from '@/lib/db';
import { getTeam } from '@/lib/team/store';
import { validateBrowserContextId } from '@/lib/browser-provider/context-validation';
import { ProviderResolutionError, resolveProviderForCapability } from '@/lib/provider-resolver';
import type { CreateSessionRequest, SessionsResponse, SessionResponse } from '@/types';
import { isLibraryChatSession } from '@/lib/chat/library-session';
import { isMainAgentSession, isWorkflowDebugSession, normalizeSessionEntry } from '@/lib/chat/session-entry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const entry = normalizeSessionEntry(request.nextUrl.searchParams.get('entry'));
    const sessions = getAllSessions().filter((session) => {
      if (isLibraryChatSession(session)) return false;
      if (isWorkflowDebugSession(session)) return false;
      return entry === 'main-agent'
        ? isMainAgentSession(session)
        : !isMainAgentSession(session);
    });
    const response: SessionsResponse = { sessions };
    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[GET /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateSessionRequest = await request.json();
    const entry = normalizeSessionEntry(body.entry);
    const workingDirectory = body.working_directory?.trim() || '';
    let browserContextId: string | undefined;
    let resolvedProviderId = '';

    if (body.browser_context_id?.trim()) {
      try {
        browserContextId = validateBrowserContextId(body.browser_context_id);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : '浏览器上下文无效', code: 'INVALID_BROWSER_CONTEXT' },
          { status: 400 },
        );
      }
    }

    try {
      const resolvedProvider = resolveProviderForCapability({
        moduleKey: 'chat',
        capability: 'agent-chat',
        preferredProviderId: body.provider_id?.trim() || undefined,
      });
      resolvedProviderId = resolvedProvider?.id || '';
    } catch (error) {
      if (error instanceof ProviderResolutionError) {
        return Response.json(
          { error: error.message, code: 'INVALID_PROVIDER' },
          { status: 400 },
        );
      }
      throw error;
    }

    if (entry !== 'main-agent' && !workingDirectory) {
      return Response.json(
        { error: 'Working directory is required', code: 'MISSING_DIRECTORY' },
        { status: 400 },
      );
    }

    if (workingDirectory) {
      try {
        await fs.access(workingDirectory);
      } catch {
        return Response.json(
          { error: 'Directory does not exist', code: 'INVALID_DIRECTORY' },
          { status: 400 },
        );
      }
    }

    const teamId = body.team_id?.trim() || '';
    if (teamId && !getTeam(teamId)) {
      return Response.json({ error: '团队不存在', code: 'INVALID_TEAM' }, { status: 400 });
    }

    const session = createSession(
      body.title,
      body.model,
      body.system_prompt,
      workingDirectory,
      body.mode,
      body.folder,
      resolvedProviderId,
      entry === 'main-agent' ? 'main-agent' : 'chat',
    );
    if (teamId) setSessionTeam(session.id, teamId);
    if (browserContextId) updateSessionBrowserContext(session.id, browserContextId);
    if (teamId || browserContextId) {
      const updated = getSession(session.id);
      const response: SessionResponse = { session: updated || session };
      return Response.json(response, { status: 201 });
    }
    const response: SessionResponse = { session };
    return Response.json(response, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[POST /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
