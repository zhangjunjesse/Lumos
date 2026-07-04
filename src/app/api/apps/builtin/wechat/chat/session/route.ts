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
  buildWeChatAssistantChatSystemPrompt,
  isWeChatAssistantChatSession,
  WECHAT_ASSISTANT_CHAT_TITLE,
} from '@/lib/chat/wechat-assistant-session';
import { getWeChatAssistantSettings } from '@/lib/wechat-assistant/settings-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { session_id?: unknown };
    await fs.mkdir(dataDir, { recursive: true });
    const settings = getWeChatAssistantSettings();
    const systemPrompt = buildWeChatAssistantChatSystemPrompt(settings.ai.prompts.assistantChat);

    const requestedSessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    if (requestedSessionId) {
      const existing = getSession(requestedSessionId);
      if (existing && isWeChatAssistantChatSession(existing)) {
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
      WECHAT_ASSISTANT_CHAT_TITLE,
      '',
      systemPrompt,
      dataDir,
      'code',
      undefined,
      undefined,
      'wechat-assistant',
    );

    return NextResponse.json({ session, reused: false, promptRefreshed: false }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建微信助手会话失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
