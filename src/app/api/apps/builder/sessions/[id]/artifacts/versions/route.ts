import { type NextRequest, NextResponse } from 'next/server';

import { createSessionStore } from '@/lib/app/builder/session';
import { getAppPlatformService } from '@/lib/app/service';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const filePath = request.nextUrl.searchParams.get('filePath')?.trim() || '';
    if (!isSafeFilePath(filePath)) {
      return NextResponse.json({ error: 'Invalid filePath' }, { status: 400 });
    }

    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    if (!store.getSession(id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({
      versions: store.listArtifactVersions(id, filePath),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

function isSafeFilePath(filePath: string): boolean {
  if (!filePath || filePath.startsWith('/') || filePath.includes('\\')) return false;
  return !filePath.split('/').includes('..');
}
