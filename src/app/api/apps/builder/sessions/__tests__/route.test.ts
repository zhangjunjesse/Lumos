import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';

import { createSessionStore } from '@/lib/app/builder/session';
import { migrateAppTables } from '@/lib/db/migrations-app';

import { POST } from '../route';

let mockDb: Database.Database;

jest.mock('@/lib/app/service', () => ({
  getAppPlatformService: () => ({ db: mockDb }),
}));

function makeReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/apps/builder/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('AppBuilder sessions route', () => {
  beforeEach(() => {
    mockDb = new Database(':memory:');
    mockDb.pragma('foreign_keys = ON');
    migrateAppTables(mockDb);
  });

  afterEach(() => {
    mockDb.close();
  });

  it('infers the Goofish starter from natural-language app requirements', async () => {
    const res = await POST(makeReq({
      appName: '闲鱼助手',
      appDescription: '帮用户回复闲鱼消息，管理商品，并通过微信 IM 通知。',
    }));
    const json = await res.json() as { session?: { id: string; status: string; templateId?: string } };

    expect(res.status).toBe(201);
    expect(json.session).toMatchObject({
      status: 'demo_review',
      templateId: 'goofish-assistant',
    });

    const store = createSessionStore(mockDb);
    const artifacts = store.getCurrentArtifacts(json.session?.id ?? '');
    expect(artifacts.map((artifact) => artifact.filePath)).toEqual(expect.arrayContaining([
      'native-app-spec.json',
      'pages/inbox.json',
      'pages/drafts.json',
      'pages/settings.json',
      'pages/im.json',
      'pages/run-history.json',
    ]));
    const spec = JSON.parse(
      artifacts.find((artifact) => artifact.filePath === 'native-app-spec.json')?.content ?? '{}',
    ) as { im?: { lowRiskCommands?: string[] } };
    expect(spec.im?.lowRiskCommands).toEqual(expect.arrayContaining([
      '/goofish status',
      '/goofish confirm <draft>',
      '/goofish reject <draft>',
    ]));

    const messages = store.listMessages(json.session?.id ?? '');
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('项目状态'),
      }),
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('接受规格'),
      }),
    ]));
  });

  it('rejects unknown explicit template ids', async () => {
    const res = await POST(makeReq({
      appName: '测试应用',
      templateId: 'missing-template',
    }));
    const json = await res.json() as { error?: string };

    expect(res.status).toBe(400);
    expect(json.error).toBe('Unknown app builder template');
  });
});
