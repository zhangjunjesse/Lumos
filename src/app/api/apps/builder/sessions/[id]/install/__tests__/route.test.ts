import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';

import { buildNativeSpecReviewPatch } from '@/lib/app/builder/native-spec-review';
import { createSessionStore } from '@/lib/app/builder/session';
import { buildTemplateBlueprintFiles } from '@/lib/app/builder/templates';
import { migrateAppTables } from '@/lib/db/migrations-app';

import { POST } from '../route';

let mockDb: Database.Database;
const mockBuildInstallContext = jest.fn();

jest.mock('@/lib/app/service', () => ({
  getAppPlatformService: () => ({ db: mockDb }),
  buildInstallContext: (...args: unknown[]) => mockBuildInstallContext(...args),
}));

function makeReq(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('http://localhost/api/apps/builder/sessions/bs_test/install', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeContext(sessionId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: sessionId }) };
}

function createGoofishBuilderSession() {
  const store = createSessionStore(mockDb);
  const session = store.createSession({
    appName: '闲鱼助手',
    appDescription: '帮用户回复闲鱼消息，管理商品，并通过微信 IM 通知。',
    templateId: 'goofish-assistant',
    initialStatus: 'demo_review',
  });
  const files = buildTemplateBlueprintFiles(session, 'goofish-assistant', {
    now: 1714470000000,
  });
  for (const [filePath, content] of Object.entries(files ?? {})) {
    store.saveArtifact({ sessionId: session.id, filePath, content });
  }
  return { store, session };
}

describe('AppBuilder install route native spec gate', () => {
  beforeEach(() => {
    mockDb = new Database(':memory:');
    mockDb.pragma('foreign_keys = ON');
    migrateAppTables(mockDb);
    mockBuildInstallContext.mockReset();
  });

  afterEach(() => {
    mockDb.close();
  });

  it('rejects install until the user accepts the current native spec', async () => {
    const { session } = createGoofishBuilderSession();

    const res = await POST(makeReq(), makeContext(session.id));
    const json = await res.json() as { error?: string; message?: string };

    expect(res.status).toBe(409);
    expect(json.error).toBe('NativeSpecReviewRequired');
    expect(json.message).toContain('接受当前版本');
    expect(mockBuildInstallContext).not.toHaveBeenCalled();
  });

  it('rejects install when the accepted native spec is stale', async () => {
    const { store, session } = createGoofishBuilderSession();
    const currentSpec = store
      .getCurrentArtifacts(session.id)
      .find((artifact) => artifact.filePath === 'native-app-spec.json');
    expect(currentSpec).toBeTruthy();
    store.setNeedsSummary(session.id, {
      ...(session.needsSummary ?? {}),
      ...buildNativeSpecReviewPatch({
        status: 'accepted',
        artifactVersion: currentSpec?.version,
        now: '2026-05-08T00:00:00.000Z',
      }),
    });

    const updatedSpec = JSON.parse(currentSpec?.content ?? '{}') as { summary?: string };
    updatedSpec.summary = `${updatedSpec.summary ?? '闲鱼助手'} 已修改`;
    const nextSpec = store.saveArtifact({
      sessionId: session.id,
      filePath: 'native-app-spec.json',
      content: `${JSON.stringify(updatedSpec, null, 2)}\n`,
    });

    const res = await POST(makeReq(), makeContext(session.id));
    const json = await res.json() as {
      error?: string;
      artifactVersion?: number;
      nativeSpecReview?: { artifactVersion?: number };
    };

    expect(res.status).toBe(409);
    expect(json.error).toBe('NativeSpecReviewRequired');
    expect(json.artifactVersion).toBe(nextSpec.version);
    expect(json.nativeSpecReview?.artifactVersion).toBe(currentSpec?.version);
    expect(mockBuildInstallContext).not.toHaveBeenCalled();
  });

  it('rejects install when native-app-spec.json is invalid', async () => {
    const store = createSessionStore(mockDb);
    const session = store.createSession({
      appName: '坏应用',
      initialStatus: 'demo_review',
    });
    store.saveArtifact({
      sessionId: session.id,
      filePath: 'native-app-spec.json',
      content: '{"version":1}\n',
    });
    store.setNeedsSummary(session.id, {
      ...(session.needsSummary ?? {}),
      ...buildNativeSpecReviewPatch({
        status: 'accepted',
        artifactVersion: 1,
        now: '2026-05-08T00:00:00.000Z',
      }),
    });

    const res = await POST(makeReq(), makeContext(session.id));
    const json = await res.json() as { error?: string; issues?: unknown[] };

    expect(res.status).toBe(400);
    expect(json.error).toBe('NativeSpecInvalid');
    expect(json.issues?.length).toBeGreaterThan(0);
    expect(mockBuildInstallContext).not.toHaveBeenCalled();
  });

  it('rejects install when the native package shell is incomplete', async () => {
    const { store, session } = createGoofishBuilderSession();
    const currentSpec = store
      .getCurrentArtifacts(session.id)
      .find((artifact) => artifact.filePath === 'native-app-spec.json');
    expect(currentSpec).toBeTruthy();
    store.setNeedsSummary(session.id, {
      ...(session.needsSummary ?? {}),
      ...buildNativeSpecReviewPatch({
        status: 'accepted',
        artifactVersion: currentSpec?.version,
        now: '2026-05-08T00:00:00.000Z',
      }),
    });
    store.saveArtifact({
      sessionId: session.id,
      filePath: 'pages/status.json',
      content: '{"title":"状态","layout":"single","blocks":[{"type":"markdown","content":"缺少自检入口"}]}\n',
    });

    const res = await POST(makeReq(), makeContext(session.id));
    const json = await res.json() as { error?: string; issues?: Array<{ file?: string; message?: string }> };

    expect(res.status).toBe(400);
    expect(json.error).toBe('NativeAppPackageInvalid');
    expect(json.issues?.some((issue) => issue.file === 'pages/status.json')).toBe(true);
    expect(mockBuildInstallContext).not.toHaveBeenCalled();
  });
});
