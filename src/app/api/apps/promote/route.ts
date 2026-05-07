import fs from 'fs';
import os from 'os';
import path from 'path';

import { type NextRequest, NextResponse } from 'next/server';

import { installApp } from '@/lib/app/installer';
import { buildInstallContext } from '@/lib/app/service';
import {
  promoteWorkflowToApp,
  type PromoteRequest,
} from '@/lib/app/workflow-promote/promote';

/**
 * POST /api/apps/promote
 *
 * Body (JSON):
 *   {
 *     "promote": PromoteRequest (without `outDir`),
 *     "consent": { "granted": [...] }   // optional; same shape as the
 *                                         // install consent dialog returns
 *   }
 *
 * Behavior:
 *   1. Promote the supplied workflow into a temp app directory.
 *   2. Install it from that directory with source: 'workflow-promoted'.
 *   3. If consent isn't pre-supplied, surface the ConsentRequest exactly
 *      like /api/apps does so the same client UI handles both flows.
 */

export async function POST(req: NextRequest): Promise<NextResponse> {
  let stagingDir: string | undefined;
  try {
    const body = (await req.json()) as {
      promote?: Omit<PromoteRequest, 'outDir'>;
      consent?: { granted: string[] };
    };
    if (!body.promote) {
      return NextResponse.json({ error: 'Missing "promote" field' }, { status: 400 });
    }
    stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-promote-'));
    const appDir = path.join(stagingDir, 'app');
    promoteWorkflowToApp({ ...body.promote, outDir: appDir });

    const consent = body.consent;
    let pendingRequest: unknown = null;
    let respondedConsent = false;

    const ctx = buildInstallContext(async (consentReq) => {
      pendingRequest = consentReq;
      if (consent && Array.isArray(consent.granted)) {
        respondedConsent = true;
        return {
          granted: consent.granted.filter((g): g is string => typeof g === 'string'),
        };
      }
      return null;
    });

    const result = await installApp({ type: 'directory', path: appDir }, ctx, {
      source: 'workflow-promoted',
    });

    if (result.ok) {
      return NextResponse.json({ ok: true, installed: result.installed, warnings: result.warnings });
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
    if (stagingDir && fs.existsSync(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
