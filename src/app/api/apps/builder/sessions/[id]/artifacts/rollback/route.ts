import { z } from 'zod';
import { type NextRequest, NextResponse } from 'next/server';

import { createSessionStore } from '@/lib/app/builder/session';
import { getAppPlatformService } from '@/lib/app/service';

const requestSchema = z.object({
  filePath: z.string().trim().min(1).max(240),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const input = requestSchema.parse(await request.json());
    if (!isSafeFilePath(input.filePath)) {
      return NextResponse.json({ error: 'Invalid filePath' }, { status: 400 });
    }

    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    if (!store.getSession(id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const rolledBack = store.rollbackArtifact(id, input.filePath);
    if (!rolledBack) {
      return NextResponse.json(
        { error: 'No current artifact version can be rolled back' },
        { status: 404 },
      );
    }

    store.appendMessage({
      sessionId: id,
      role: 'tool',
      toolName: 'rollback_app_file',
      content: {
        summary: '已回滚应用草稿文件',
        filePath: input.filePath,
      },
    });

    return NextResponse.json({
      ok: true,
      artifacts: store.getCurrentArtifacts(id),
      versions: store.listArtifactVersions(id, input.filePath),
      messages: store.listMessages(id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rollback failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function isSafeFilePath(filePath: string): boolean {
  if (!filePath || filePath.startsWith('/') || filePath.includes('\\')) return false;
  return !filePath.split('/').includes('..');
}
