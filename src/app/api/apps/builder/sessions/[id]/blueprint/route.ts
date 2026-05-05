import { type NextRequest, NextResponse } from 'next/server';

import { buildLocalBlueprintFiles } from '@/lib/app/builder/local-blueprint';
import { createSessionStore } from '@/lib/app/builder/session';
import { getAppPlatformService } from '@/lib/app/service';

/**
 * POST /api/apps/builder/sessions/<id>/blueprint
 *
 * Generates a deterministic local scaffold for UI and install-path
 * verification while the AI runtime is still being wired.
 */

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const { db } = getAppPlatformService();
    const store = createSessionStore(db);
    const session = store.getSession(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const files = buildLocalBlueprintFiles(session);
    store.updateStatus(id, 'generating');
    store.setNeedsSummary(id, {
      ...(session.needsSummary ?? {}),
      appName: session.appName ?? '未命名应用',
      appDescription: session.appDescription ?? '',
      localBlueprint: true,
      updatedBy: 'local-scaffold',
    });

    const artifacts = Object.entries(files).map(([filePath, content]) =>
      store.saveArtifact({ sessionId: id, filePath, content }),
    );
    store.appendMessage({
      sessionId: id,
      role: 'tool',
      toolName: 'local_blueprint',
      content: {
        summary: '已生成本地开发草图',
        files: Object.keys(files),
      },
    });
    store.appendMessage({
      sessionId: id,
      role: 'assistant',
      content:
        '本地开发草图已经生成。你可以在主区域预览页面、查看文件并执行安装自检；这不是完整 AI 生成结果，但可以先把开发界面的主链跑起来。',
    });

    return NextResponse.json({
      ok: true,
      files: Object.keys(files),
      artifacts,
      session: store.getSession(id),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
