import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';

import { buildNativeSpecReviewPatch } from '@/lib/app/builder/native-spec-review';
import { createSessionStore } from '@/lib/app/builder/session';
import { buildTemplateBlueprintFiles } from '@/lib/app/builder/templates';
import { migrateAppTables } from '@/lib/db/migrations-app';

import { POST } from '../route';

let mockDb: Database.Database;

jest.mock('@/lib/app/service', () => ({
  getAppPlatformService: () => ({ db: mockDb }),
}));

function makeReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/apps/builder/sessions/bs_test/artifacts', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeContext(sessionId: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: sessionId }) };
}

function createAcceptedGoofishBuilderSession() {
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
  return { store, session, currentSpec };
}

describe('AppBuilder artifacts route native spec review state', () => {
  beforeEach(() => {
    mockDb = new Database(':memory:');
    mockDb.pragma('foreign_keys = ON');
    migrateAppTables(mockDb);
  });

  afterEach(() => {
    mockDb.close();
  });

  it('marks native spec review pending when native-app-spec.json changes', async () => {
    const { store, session, currentSpec } = createAcceptedGoofishBuilderSession();
    const updatedSpec = JSON.parse(currentSpec?.content ?? '{}') as { summary?: string };
    updatedSpec.summary = `${updatedSpec.summary ?? '闲鱼助手'} 已调整`;

    const res = await POST(makeReq({
      filePath: 'native-app-spec.json',
      content: `${JSON.stringify(updatedSpec, null, 2)}\n`,
    }), makeContext(session.id));
    const json = await res.json() as { artifact?: { version?: number } };

    expect(res.status).toBe(201);
    expect(json.artifact?.version).toBe((currentSpec?.version ?? 0) + 1);

    const nextSession = store.getSession(session.id);
    expect(nextSession?.needsSummary?.nativeSpecReview).toMatchObject({
      status: 'pending',
      artifactVersion: json.artifact?.version,
      note: '规格已更新，等待用户接受。',
    });
  });
});
