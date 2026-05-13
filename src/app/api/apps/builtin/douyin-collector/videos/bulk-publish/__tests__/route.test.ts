import { NextRequest } from 'next/server';

const fakeStore = {
  query: jest.fn(),
};
const publishVideoToKnowledgeMock = jest.fn();
const getDouyinCollectorSettingsMock = jest.fn();
const dbGetMock = jest.fn();

jest.mock('@/lib/douyin-collector/storage', () => ({
  getDouyinCollectorStore: () => fakeStore,
}));

jest.mock('@/lib/douyin-collector/publish', () => ({
  publishVideoToKnowledge: (...args: unknown[]) => publishVideoToKnowledgeMock(...args),
}));

jest.mock('@/lib/douyin-collector/settings', () => ({
  getDouyinCollectorSettings: () => getDouyinCollectorSettingsMock(),
}));

jest.mock('@/lib/db', () => ({
  getDb: () => ({
    prepare: () => ({
      get: (...args: unknown[]) => dbGetMock(...args),
    }),
  }),
}));

import { POST } from '../route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/apps/builtin/douyin-collector/videos/bulk-publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('douyin bulk-publish route', () => {
  beforeEach(() => {
    fakeStore.query.mockReset();
    publishVideoToKnowledgeMock.mockReset();
    getDouyinCollectorSettingsMock.mockReset();
    dbGetMock.mockReset();
    getDouyinCollectorSettingsMock.mockReturnValue({ libraryCollectionId: 'col-current' });
    publishVideoToKnowledgeMock.mockResolvedValue({ ok: true, itemId: 'item-1', collectionId: 'col-current' });
  });

  it('repairs published videos whose current knowledge item is not indexed', async () => {
    fakeStore.query.mockReturnValue([
      {
        id: 'published-stale',
        aweme_id: 'a-stale',
        transcript_status: 'success',
        library_status: 'published',
      },
      {
        id: 'published-enhancement-missing',
        aweme_id: 'a-enhancement-missing',
        transcript_status: 'success',
        library_status: 'published',
      },
      {
        id: 'published-ready',
        aweme_id: 'a-ready',
        transcript_status: 'success',
        library_status: 'published',
      },
      {
        id: 'draft-ready',
        aweme_id: 'a-draft',
        transcript_status: 'success',
        library_status: 'draft',
      },
      {
        id: 'discarded-stale',
        aweme_id: 'a-discarded',
        transcript_status: 'success',
        library_status: 'discarded',
      },
      {
        id: 'no-transcript',
        aweme_id: 'a-no-transcript',
        transcript_status: 'pending',
        library_status: 'draft',
      },
    ]);
    dbGetMock.mockImplementation((collectionId: string, sourceKey: string) => {
      expect(collectionId).toBe('col-current');
      if (sourceKey === 'douyin:a-ready') {
        return {
          processing_status: 'ready',
          chunk_count: 2,
          processing_detail: JSON.stringify({ summary: 'done' }),
          summary: '已有索引概述',
          key_points: JSON.stringify(['要点']),
          tags: JSON.stringify(['AI']),
        };
      }
      if (sourceKey === 'douyin:a-stale') {
        return { processing_status: 'pending', chunk_count: 0 };
      }
      if (sourceKey === 'douyin:a-enhancement-missing') {
        return {
          processing_status: 'ready',
          chunk_count: 1,
          processing_detail: JSON.stringify({ summary: 'skipped' }),
          summary: '',
          key_points: '[]',
          tags: '[]',
        };
      }
      return undefined;
    });

    const res = await POST(makeReq({ scope: 'draft', limit: 30 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, processed: 3, succeeded: 3, failed: 0 });
    expect(publishVideoToKnowledgeMock).toHaveBeenCalledTimes(3);
    expect(publishVideoToKnowledgeMock).toHaveBeenNthCalledWith(1, 'published-stale', 'col-current');
    expect(publishVideoToKnowledgeMock).toHaveBeenNthCalledWith(
      2,
      'published-enhancement-missing',
      'col-current',
    );
    expect(publishVideoToKnowledgeMock).toHaveBeenNthCalledWith(3, 'draft-ready', 'col-current');
    expect(publishVideoToKnowledgeMock).not.toHaveBeenCalledWith('published-ready', expect.anything());
    expect(publishVideoToKnowledgeMock).not.toHaveBeenCalledWith('discarded-stale', expect.anything());
    expect(publishVideoToKnowledgeMock).not.toHaveBeenCalledWith('no-transcript', expect.anything());
  });
});
