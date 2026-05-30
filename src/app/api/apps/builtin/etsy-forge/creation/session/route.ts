// 创作区会话：建一个隔离的创作对话会话（照资料库会话那套）。前端复用 ChatView 渲染。

import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/db';
import { dataDir } from '@/lib/db/connection';
import { buildCreationChatSystemPrompt, CREATION_CHAT_TITLE } from '@/lib/chat/creation-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await request.json().catch(() => ({}));
    await fs.mkdir(dataDir, { recursive: true });

    const session = createSession(
      CREATION_CHAT_TITLE,
      '',
      buildCreationChatSystemPrompt(),
      dataDir,
      'code',
    );

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '初始化创作区会话失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
