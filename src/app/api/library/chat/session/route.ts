import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/db';
import { dataDir } from '@/lib/db/connection';
import { buildLibraryChatSystemPrompt, LIBRARY_CHAT_TITLE } from '@/lib/chat/library-session';

export async function POST(request: NextRequest) {
  try {
    await request.json().catch(() => ({}));
    await fs.mkdir(dataDir, { recursive: true });

    const session = createSession(
      LIBRARY_CHAT_TITLE,
      '',
      buildLibraryChatSystemPrompt(),
      dataDir,
      'code',
    );

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create library chat session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
