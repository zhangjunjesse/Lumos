import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { getAllSessions, createSession } from '@/lib/db';
import { ProviderResolutionError, resolveProviderForCapability } from '@/lib/provider-resolver';
import type { CreateSessionRequest, SessionsResponse, SessionResponse } from '@/types';
import { isLibraryChatSession } from '@/lib/chat/library-session';
import { isMainAgentSession, normalizeSessionEntry, withSessionEntryMarker } from '@/lib/chat/session-entry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const entry = normalizeSessionEntry(request.nextUrl.searchParams.get('entry'));
    const sessions = getAllSessions().filter((session) => {
      if (isLibraryChatSession(session)) return false;
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
    let resolvedProviderId = '';

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

    const session = createSession(
      body.title,
      body.model,
      withSessionEntryMarker(body.system_prompt, entry),
      workingDirectory,
      body.mode,
      body.folder,
      resolvedProviderId,
    );
    const response: SessionResponse = { session };
    return Response.json(response, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[POST /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
