import fs from 'fs';
import path from 'path';

import { type NextRequest, NextResponse } from 'next/server';

import { resolveAssetPath } from '@/lib/app/installer/asset-resolver';
import { getAppPlatformService } from '@/lib/app/service';

/**
 * GET /api/apps/<id>/assets/<...path>
 *
 * Serves files from a single installed app's directory, scoped strictly
 * to the install_path recorded in lumos_app_apps. Used by the renderer to
 * load routes.json, pages/*.json, locales/*.json, assets/*, icon.png, etc.
 *
 * The hard work happens in resolveAssetPath (unit-tested) — this handler
 * just wires the database lookup and translates the result to HTTP.
 * Every rejection collapses to 404 so probing cannot distinguish between
 * "not allowed" and "doesn't exist".
 */

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string; path: string[] }> },
): Promise<NextResponse | Response> {
  try {
    const { id, path: segments } = await context.params;

    const svc = getAppPlatformService();
    const row = svc.db
      .prepare(`SELECT install_path FROM lumos_app_apps WHERE id = ?`)
      .get(id) as { install_path: string } | undefined;
    if (!row) return notFound();

    const resolved = resolveAssetPath(row.install_path, segments);
    if (!resolved.ok) {
      if (resolved.reason === 'TooLarge') {
        return NextResponse.json({ error: 'Asset too large' }, { status: 413 });
      }
      return notFound();
    }

    const ext = path.extname(resolved.absolutePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

    const data = fs.readFileSync(resolved.absolutePath);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(data.length),
        // install path is version-scoped so no cross-version aliasing,
        // but keep responses fresh for now until M2 ships explicit
        // versioned cache busting.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
