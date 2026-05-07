import fs from 'fs';
import os from 'os';
import path from 'path';

import { type NextRequest, NextResponse } from 'next/server';

import { parseApp } from '@/lib/app/manifest/parser';
import { validateApp } from '@/lib/app/manifest/validator';

/**
 * POST /api/apps/validate
 *
 * Body: multipart with `file` field (a .lumos-app zip).
 *
 * Used by the AI builder and developer CLI to confirm a manifest is valid
 * before attempting to install it. Returns issues + warnings without ever
 * touching the install database.
 */

export async function POST(req: NextRequest): Promise<NextResponse> {
  let tmpDir: string | undefined;
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Missing "file" field in multipart form' },
        { status: 400 },
      );
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-app-validate-'));
    const zipPath = path.join(tmpDir, 'package.lumos-app');
    fs.writeFileSync(zipPath, Buffer.from(await file.arrayBuffer()));

    // We piggy-back on installApp's unpack by extracting via JSZip.
    const JSZip = (await import('jszip')).default;
    const data = await fs.promises.readFile(zipPath);
    const zip = await JSZip.loadAsync(data);
    const stagingDir = path.join(tmpDir, 'staged');
    fs.mkdirSync(stagingDir, { recursive: true });

    for (const [filePath, entry] of Object.entries(zip.files)) {
      // Cheap zip-slip check; the strict version lives in the installer.
      if (filePath.includes('..') || filePath.includes('\\') || /^[A-Za-z]:/.test(filePath)) {
        return NextResponse.json(
          { ok: false, error: 'UnsafePath', detail: filePath },
          { status: 400 },
        );
      }
      const safe = path.posix.normalize(filePath).replace(/^\/+/, '');
      const full = path.join(stagingDir, safe);
      if (entry.dir) {
        fs.mkdirSync(full, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, await entry.async('nodebuffer'));
    }

    const parsed = parseApp(stagingDir);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, issues: parsed.issues });
    }
    const cross = validateApp(parsed.app);
    const errors = cross.filter((i) => i.level === 'error');
    return NextResponse.json({
      ok: errors.length === 0,
      manifest: parsed.app.manifest,
      issues: cross,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
