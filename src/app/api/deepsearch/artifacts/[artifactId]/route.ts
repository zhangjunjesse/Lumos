import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { dataDir } from '@/lib/db';
import { getDeepSearchArtifactView } from '@/lib/deepsearch/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ artifactId: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { artifactId } = await context.params;

  try {
    const artifact = await getDeepSearchArtifactView(artifactId);
    if (!artifact) {
      return NextResponse.json({ error: 'DeepSearch artifact not found' }, { status: 404 });
    }

    const resolved = path.resolve(artifact.storagePath);
    const root = path.resolve(path.join(dataDir, 'deepsearch-artifacts'));
    if (!resolved.startsWith(root)) {
      return NextResponse.json({ error: 'DeepSearch artifact access denied' }, { status: 403 });
    }

    const content = await fs.readFile(resolved);
    const fileName = encodeURIComponent(path.basename(resolved));
    return new Response(content, {
      headers: {
        'Content-Type': artifact.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename*=UTF-8''${fileName}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load DeepSearch artifact' },
      { status: 500 },
    );
  }
}
