import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';

import {
  createSession,
  getSession,
  updateSdkSessionId,
  updateSessionSystemPrompt,
} from '@/lib/db';
import { dataDir } from '@/lib/db/connection';
import {
  buildGoofishAssistantChatSystemPrompt,
  isGoofishAssistantChatSession,
  GOOFISH_ASSISTANT_CHAT_TITLE,
} from '@/lib/chat/goofish-assistant-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { session_id?: unknown };
    await fs.mkdir(dataDir, { recursive: true });
    const customPrompt = await readCustomPrompt();
    const systemPrompt = buildGoofishAssistantChatSystemPrompt(customPrompt);

    const requestedSessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    if (requestedSessionId) {
      const existing = getSession(requestedSessionId);
      if (existing && isGoofishAssistantChatSession(existing)) {
        const promptChanged = existing.system_prompt !== systemPrompt;
        if (promptChanged) {
          updateSessionSystemPrompt(existing.id, systemPrompt);
          updateSdkSessionId(existing.id, '');
        }
        return NextResponse.json({
          session: promptChanged ? getSession(existing.id) ?? existing : existing,
          reused: true,
          promptRefreshed: promptChanged,
        });
      }
    }

    const session = createSession(
      GOOFISH_ASSISTANT_CHAT_TITLE,
      '',
      systemPrompt,
      dataDir,
      'code',
    );

    return NextResponse.json({ session, reused: false, promptRefreshed: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建闲鱼助手会话失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function readCustomPrompt(): Promise<string | null> {
  try {
    const { getAppPlatformService } = await import('@/lib/app/service');
    const { createAppDataStore } = await import('@/lib/app/runtime/data-store');
    const svc = getAppPlatformService();
    const store = createAppDataStore(svc.db, 'goofish-assistant');
    const rows = store.query<{ ai_system_prompt?: string }>('app_settings', { limit: 1 });
    const row = rows[0];
    const value = row?.ai_system_prompt;
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}
