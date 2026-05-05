import { NextResponse, type NextRequest } from 'next/server';

import { createSessionStore } from '@/lib/app/builder/session';
import {
  BLANK_APP_BUILDER_TEMPLATE_ID,
  buildTemplateBlueprintFiles,
  getAppBuilderTemplate,
} from '@/lib/app/builder/templates';
import { getAppPlatformService } from '@/lib/app/service';

/**
 * GET  /api/apps/builder/sessions       — list builder sessions, newest first
 * POST /api/apps/builder/sessions       — create a session (optionally with
 *                                         templateId / llmModel)
 *
 * The agent runtime (B2) reads the system prompt from sessions tagged with
 * a templateId; the conversation lives in /sessions/<id>/messages, the
 * generated files in artifacts. v1 ships the persistence + CRUD; the
 * Claude SDK bridge replaces a mock-assistant POST in the next chunk.
 */

export async function GET(): Promise<NextResponse> {
  try {
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    const sessions = store.listSessions({ limit: 100 });
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      appName?: string;
      appDescription?: string;
      templateId?: string;
      llmModel?: string;
    };
    if (typeof body.appName !== 'string' || body.appName.trim().length === 0) {
      return NextResponse.json(
        { error: 'appName is required' },
        { status: 400 },
      );
    }
    if (body.appName.length > 64) {
      return NextResponse.json(
        { error: 'appName must be ≤ 64 characters' },
        { status: 400 },
      );
    }
    const description = typeof body.appDescription === 'string' ? body.appDescription.trim() : '';
    if (description.length > 500) {
      return NextResponse.json(
        { error: 'appDescription must be ≤ 500 characters' },
        { status: 400 },
      );
    }
    const templateId = normalizeTemplateId(body.templateId);
    const template = getAppBuilderTemplate(templateId);
    if (templateId && !template) {
      return NextResponse.json(
        { error: 'Unknown app builder template' },
        { status: 400 },
      );
    }
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    const session = store.createSession({
      appName: body.appName.trim(),
      appDescription: description || undefined,
      templateId: templateId || undefined,
      llmModel: body.llmModel,
      initialStatus: template ? 'demo_review' : 'gathering',
    });
    if (template) {
      const files = buildTemplateBlueprintFiles(session, template.id);
      for (const [filePath, content] of Object.entries(files ?? {})) {
        store.saveArtifact({ sessionId: session.id, filePath, content });
      }
      store.appendMessage({
        sessionId: session.id,
        role: 'tool',
        toolName: 'app_builder_template',
        content: {
          summary: `已套用「${template.name}」模板`,
          files: Object.keys(files ?? {}),
        },
      });
      store.appendMessage({
        sessionId: session.id,
        role: 'assistant',
        content: `我已经把「${template.name}」模板放到左侧预览里了。你可以直接说要改哪些字段、页面、按钮或流程。`,
      });
    }
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function normalizeTemplateId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  return id === BLANK_APP_BUILDER_TEMPLATE_ID ? '' : id;
}
