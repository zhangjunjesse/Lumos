import fs from 'fs';
import os from 'os';
import path from 'path';

import { type NextRequest, NextResponse } from 'next/server';

import { createSessionStore } from '@/lib/app/builder/session';
import { installApp, type ConsentRequest } from '@/lib/app/installer';
import { buildInstallContext, getAppPlatformService } from '@/lib/app/service';

/**
 * POST /api/apps/builder/sessions/<id>/install
 *
 * Installs the current builder artifacts as an ai-generated Lumos app.
 * This mirrors /api/apps upload consent semantics: first call may return
 * needsConsent, the client retries with { consent: { granted: [...] } }.
 */

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let tmpDir: string | undefined;
  try {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as {
      consent?: { granted?: unknown };
    };

    const svc = getAppPlatformService();
    const store = createSessionStore(svc.db);
    const session = store.getSession(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const artifacts = store.getCurrentArtifacts(id);
    if (artifacts.length === 0) {
      return NextResponse.json(
        { error: 'No generated files to install' },
        { status: 400 },
      );
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-builder-install-'));
    for (const artifact of artifacts) {
      if (!isSafeRelativePath(artifact.filePath)) {
        return NextResponse.json(
          { error: `Unsafe artifact path: ${artifact.filePath}` },
          { status: 400 },
        );
      }
      const fullPath = path.join(tmpDir, artifact.filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, artifact.content);
    }
    const iconPath = path.join(tmpDir, 'icon.png');
    if (!fs.existsSync(iconPath)) {
      fs.writeFileSync(iconPath, Buffer.from(DEFAULT_ICON_PNG_BASE64, 'base64'));
    }

    let pendingRequest: ConsentRequest | null = null;
    let respondedConsent = false;
    const ctx = buildInstallContext(async (consentReq) => {
      pendingRequest = consentReq;
      if (consentReq.permissions.length === 0) {
        return { granted: [] };
      }
      if (Array.isArray(body.consent?.granted)) {
        respondedConsent = true;
        return {
          granted: body.consent.granted.filter((g): g is string => typeof g === 'string'),
        };
      }
      return null;
    });

    const result = await installApp(
      { type: 'directory', path: tmpDir },
      ctx,
      { source: 'ai-generated' },
    );

    if (result.ok) {
      store.commitArtifacts(id);
      store.bindToApp(id, result.installed.appId);
      store.updateStatus(id, 'installed');
      return NextResponse.json({
        ok: true,
        installed: result.installed,
        warnings: result.warnings,
      });
    }

    if (result.error === 'UserCancelled' && pendingRequest && !respondedConsent) {
      return NextResponse.json(
        { ok: false, needsConsent: true, request: pendingRequest },
        { status: 409 },
      );
    }

    const status =
      result.error === 'ManifestInvalid' || result.error === 'CrossFileInvalid'
        ? 400
        : result.error === 'VersionConflict'
          ? 409
          : 500;
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        message: result.message,
        issues: result.issues,
      },
      { status },
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

const DEFAULT_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function isSafeRelativePath(p: string): boolean {
  if (typeof p !== 'string' || p === '') return false;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  if (p.includes('\\')) return false;
  const normalized = path.posix.normalize(p);
  if (normalized.startsWith('/')) return false;
  if (normalized.split('/').includes('..')) return false;
  return true;
}
