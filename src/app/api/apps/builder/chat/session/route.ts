import fs from 'fs/promises';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';

import { getAppPlatformService } from '@/lib/app/service';
import { createSessionStore } from '@/lib/app/builder/session';
import {
  APP_BUILDER_CHAT_TITLE,
  buildAppBuilderChatSessionBindingKey,
  buildAppBuilderChatSystemPrompt,
  formatBuilderMessageForChat,
  isAppBuilderChatSession,
  resolveAppBuilderProviderAndModel,
} from '@/lib/chat/app-builder-session';
import {
  addMessage,
  createSession,
  getMessages,
  getSession,
  getSetting,
  setSetting,
} from '@/lib/db';
import { dataDir } from '@/lib/db/connection';

const postSchema = z.object({
  builderSessionId: z.string().min(1),
});

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const builderSessionId = url.searchParams.get('builderSessionId')?.trim() || '';
    if (!builderSessionId) {
      return NextResponse.json({ error: 'builderSessionId required' }, { status: 400 });
    }

    const session = lookupBoundChatSession(builderSessionId);
    if (!session) {
      return NextResponse.json({ session: null });
    }

    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : '查找应用开发会话失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = postSchema.parse(body);

    const existing = lookupBoundChatSession(input.builderSessionId);
    if (existing) {
      return NextResponse.json({ session: existing });
    }

    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    const builderSession = store.getSession(input.builderSessionId);
    if (!builderSession) {
      return NextResponse.json({ error: '应用草稿不存在' }, { status: 404 });
    }

    await fs.mkdir(dataDir, { recursive: true });

    const providerModel = resolveAppBuilderProviderAndModel();
    const session = createSession(
      APP_BUILDER_CHAT_TITLE,
      'error' in providerModel ? '' : providerModel.model,
      buildAppBuilderChatSystemPrompt(builderSession),
      dataDir,
      'code',
      undefined,
      'error' in providerModel ? undefined : providerModel.providerId,
      'app-builder',
    );

    setSetting(buildAppBuilderChatSessionBindingKey(input.builderSessionId), session.id);
    seedChatMessagesFromBuilder(input.builderSessionId, session.id);

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建应用开发会话失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function lookupBoundChatSession(builderSessionId: string) {
  const bindingKey = buildAppBuilderChatSessionBindingKey(builderSessionId);
  const sessionId = (getSetting(bindingKey) || '').trim();
  if (!sessionId) return null;

  const session = getSession(sessionId);
  if (!session || !isAppBuilderChatSession(session)) {
    setSetting(bindingKey, '');
    return null;
  }

  return session;
}

function seedChatMessagesFromBuilder(builderSessionId: string, chatSessionId: string): void {
  const existing = getMessages(chatSessionId, { limit: 1 });
  if (existing.messages.length > 0) return;

  const { db } = getAppPlatformService();
  const store = createSessionStore(db);
  const builderMessages = store.listMessages(builderSessionId);

  for (const message of builderMessages) {
    if (message.role === 'tool') continue;
    const content = formatBuilderMessageForChat(message).trim();
    if (!content) continue;
    addMessage(chatSessionId, message.role, content);
  }
}
