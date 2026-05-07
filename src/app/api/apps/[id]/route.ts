import { type NextRequest, NextResponse } from 'next/server';

import { uninstallApp } from '@/lib/app/installer';
import type { AppManifest } from '@/lib/app/manifest';
import { buildUninstallContext, getAppPlatformService } from '@/lib/app/service';

/**
 * GET    /api/apps/<id>     — full detail (manifest + install metadata + permissions list)
 * DELETE /api/apps/<id>     — uninstall (?keepData=false to also purge user data)
 */

interface AppDetail {
  id: string;
  name: string;
  version: string;
  previousVersion: string | null;
  source: string;
  installedAt: number;
  lastUsedAt: number | null;
  enabled: boolean;
  installPath: string;
  sizeBytes: number | null;
  manifest: AppManifest;
  permissions: Array<{ permission: string; granted: boolean; grantedAt: number }>;
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const svc = getAppPlatformService();
    const row = svc.db
      .prepare(
        `SELECT id, name, version, previous_version, source, manifest_json,
                installed_at, last_used_at, enabled, install_path, size_bytes
         FROM lumos_app_apps WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          name: string;
          version: string;
          previous_version: string | null;
          source: string;
          manifest_json: string;
          installed_at: number;
          last_used_at: number | null;
          enabled: number;
          install_path: string;
          size_bytes: number | null;
        }
      | undefined;
    if (!row) {
      return NextResponse.json({ error: 'Not installed' }, { status: 404 });
    }

    const permRows = svc.db
      .prepare(
        `SELECT permission, granted, granted_at FROM lumos_app_permissions
         WHERE app_id = ? ORDER BY permission`,
      )
      .all(id) as Array<{ permission: string; granted: number; granted_at: number }>;

    const detail: AppDetail = {
      id: row.id,
      name: row.name,
      version: row.version,
      previousVersion: row.previous_version,
      source: row.source,
      installedAt: row.installed_at,
      lastUsedAt: row.last_used_at,
      enabled: row.enabled === 1,
      installPath: row.install_path,
      sizeBytes: row.size_bytes,
      manifest: JSON.parse(row.manifest_json) as AppManifest,
      permissions: permRows.map((p) => ({
        permission: p.permission,
        granted: p.granted === 1,
        grantedAt: p.granted_at,
      })),
    };
    return NextResponse.json({ app: detail });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const url = new URL(req.url);
    const keepData = url.searchParams.get('keepData') !== 'false';
    const purgePrevious = url.searchParams.get('purgePrevious') !== 'false';

    const result = await uninstallApp(id, buildUninstallContext(), { keepData, purgePrevious });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, message: result.message },
        { status: result.error === 'NotInstalled' ? 404 : 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      appId: result.appId,
      deletedPaths: result.deletedPaths,
      deletedDataRows: result.deletedDataRows,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
