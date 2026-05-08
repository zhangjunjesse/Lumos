import { type NextRequest, NextResponse } from 'next/server';

import {
  NATIVE_APP_SPEC_FILE,
  validateNativeGradeAppSpec,
} from '@/lib/app/builder/native-grade-spec';
import { buildNativeSpecReviewPatch } from '@/lib/app/builder/native-spec-review';
import { createSessionStore } from '@/lib/app/builder/session';
import { getAppPlatformService } from '@/lib/app/service';

/**
 * GET   /api/apps/builder/sessions/<id>/artifacts                — current artifacts
 * POST  /api/apps/builder/sessions/<id>/artifacts                — append a draft
 *                                                                  body: { filePath, content }
 *
 * The agent runtime calls POST after every successful generate_* tool,
 * staging files as drafts. The UI can preview them straight from
 * artifacts (so users see file production live), and the install_app
 * tool flips drafts → committed at install time.
 */

const PATH_RE = /^[a-z0-9_./-]+$/i;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    if (!store.getSession(id)) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ artifacts: store.getCurrentArtifacts(id) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as {
      filePath?: string;
      content?: string;
    };
    if (typeof body.filePath !== 'string' || !PATH_RE.test(body.filePath)) {
      return NextResponse.json(
        { error: 'filePath must be a relative path containing [A-Za-z0-9_./-]' },
        { status: 400 },
      );
    }
    if (body.filePath.includes('..') || body.filePath.startsWith('/')) {
      return NextResponse.json({ error: 'filePath must be relative without ..' }, { status: 400 });
    }
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }
    if (body.filePath === NATIVE_APP_SPEC_FILE) {
      const issues = validateNativeGradeAppSpec(new Map([[NATIVE_APP_SPEC_FILE, body.content]]));
      if (issues.length > 0) {
        return NextResponse.json(
          {
            error: 'native-app-spec.json failed validation',
            issues,
          },
          { status: 400 },
        );
      }
    }

    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    const session = store.getSession(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const artifact = store.saveArtifact({
      sessionId: id,
      filePath: body.filePath,
      content: body.content,
    });
    if (body.filePath === NATIVE_APP_SPEC_FILE) {
      store.setNeedsSummary(id, {
        ...(session.needsSummary ?? {}),
        ...buildNativeSpecReviewPatch({
          status: 'pending',
          artifactVersion: artifact.version,
          note: '规格已更新，等待用户接受。',
        }),
      });
    }
    return NextResponse.json({ artifact }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
