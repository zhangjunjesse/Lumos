import fs from 'fs';
import os from 'os';
import path from 'path';

import { type NextRequest, NextResponse } from 'next/server';

import { createSessionStore } from '@/lib/app/builder/session';
import { installApp } from '@/lib/app/installer';
import type { ConsentRequest } from '@/lib/app/installer';
import { buildInstallContext, getAppPlatformService } from '@/lib/app/service';

/**
 * GET  /api/apps           — list installed apps (id, name, version, size, last_used_at)
 * POST /api/apps           — install from a multipart .lumos-app upload
 *
 * The install flow returns a ConsentRequest to the client when permissions
 * need user approval. This implementation expects the request to include a
 * `consent` field (granted permission strings) up front, because Next.js
 * route handlers are stateless. The interactive flow lives in the renderer:
 * the client first uploads with no consent → server returns 409 with the
 * ConsentRequest payload → client re-uploads with consent.
 */

interface ListedApp {
  id: string;
  name: string;
  version: string;
  source: string;
  enabled: boolean;
  installedAt: number;
  lastUsedAt: number | null;
  sizeBytes: number | null;
}

export async function GET(): Promise<NextResponse> {
  try {
    const svc = getAppPlatformService();
    const rows = svc.db
      .prepare(
        `SELECT id, name, version, source, enabled, installed_at, last_used_at, size_bytes
         FROM lumos_app_apps
         ORDER BY enabled DESC, last_used_at DESC, installed_at DESC`,
      )
      .all() as Array<{
      id: string;
      name: string;
      version: string;
      source: string;
      enabled: number;
      installed_at: number;
      last_used_at: number | null;
      size_bytes: number | null;
    }>;
    const apps: ListedApp[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      source: r.source,
      enabled: r.enabled === 1,
      installedAt: r.installed_at,
      lastUsedAt: r.last_used_at,
      sizeBytes: r.size_bytes,
    }));

    // Drafts: builder sessions that haven't produced an installed app yet.
    // Sessions whose status is 'failed' surface separately as failed
    // attempts; for the list we keep only actively-buildable ones.
    const store = createSessionStore(svc.db);
    const draftSessions = store
      .listSessions({ limit: 100 })
      .filter((s) => !s.appId && s.status !== 'failed' && s.appName);
    const drafts = draftSessions.map((s) => ({
      sessionId: s.id,
      name: s.appName ?? '未命名应用',
      description: s.appDescription ?? '',
      status: s.status,
      updatedAt: s.updatedAt,
    }));

    return NextResponse.json({ apps, drafts });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let zipPath: string | undefined;
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing "file" field in multipart form' }, { status: 400 });
    }
    const consentRaw = form.get('consent');
    const requestedSource = form.get('source');
    const sourceLabel: 'ai-generated' | 'workflow-promoted' | 'local' =
      requestedSource === 'ai-generated' || requestedSource === 'workflow-promoted'
        ? requestedSource
        : 'local';

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-app-upload-'));
    zipPath = path.join(tmpDir, 'package.lumos-app');
    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    let pendingRequest: ConsentRequest | null = null;
    let respondedConsent = false;
    const consentPayload =
      typeof consentRaw === 'string' && consentRaw.length > 0 ? safeJson(consentRaw) : null;

    const ctx = buildInstallContext(async (consentReq) => {
      pendingRequest = consentReq;
      if (consentPayload && Array.isArray((consentPayload as { granted?: unknown }).granted)) {
        respondedConsent = true;
        const granted = (consentPayload as { granted: string[] }).granted.filter(
          (g) => typeof g === 'string',
        );
        return { granted };
      }
      // No consent provided → cancel the install. Client retries with consent.
      return null;
    });

    const result = await installApp({ type: 'zip', path: zipPath }, ctx, {
      source: sourceLabel,
    });

    if (result.ok) {
      return NextResponse.json({ ok: true, installed: result.installed, warnings: result.warnings });
    }

    if (result.error === 'UserCancelled' && pendingRequest && !respondedConsent) {
      // Surface the consent payload so the client can show the dialog.
      return NextResponse.json(
        {
          ok: false,
          needsConsent: true,
          request: pendingRequest,
        },
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
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  } finally {
    if (zipPath && fs.existsSync(zipPath)) {
      try {
        fs.rmSync(path.dirname(zipPath), { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
