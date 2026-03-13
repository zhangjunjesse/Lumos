import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { getAllSessions, createSession } from '@/lib/db';
import type { CreateSessionRequest, SessionsResponse, SessionResponse } from '@/types';
import { isLibraryChatSession } from '@/lib/chat/library-session';
import { isMainAgentSession, normalizeSessionEntry, withSessionEntryMarker } from '@/lib/chat/session-entry';

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
    );
    const response: SessionResponse = { session };
    return Response.json(response, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[POST /api/chat/sessions] Error:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
