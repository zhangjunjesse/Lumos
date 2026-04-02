const getDbMock = jest.fn();

jest.mock('@/lib/db', () => ({
  getDb: () => getDbMock(),
}));

import {
  appendProcessingMessage,
  buildStoredPreviewContent,
  loadFullItemContent,
} from '@/lib/knowledge/pipeline-support';

describe('knowledge pipeline support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('stores a stable preview for long documents instead of dropping content', () => {
    const content = `标题\n\n${'A'.repeat(2500)}`;
    const preview = buildStoredPreviewContent(content);

    expect(preview.startsWith('标题')).toBe(true);
    expect(preview).toHaveLength(2000);
  });

  test('deduplicates repeated processing messages', () => {
    const first = appendProcessingMessage('', '摘要', 'summary_empty');
    const second = appendProcessingMessage(first, '摘要', 'summary_empty');

    expect(second).toBe('摘要: summary_empty');
  });

  test('prefers chunk content over preview fallback when reconstructing full text', () => {
    const allMock = jest.fn().mockReturnValue([
      { content: '第一段全文' },
      { content: '第二段全文' },
    ]);
    getDbMock.mockReturnValue({
      prepare: jest.fn().mockReturnValue({ all: allMock }),
    });

    expect(loadFullItemContent('item-1', '预览片段')).toBe('第一段全文\n\n第二段全文');
  });
});
