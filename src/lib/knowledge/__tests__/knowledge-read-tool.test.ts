import * as store from '../store';
import { loadFullItemContent } from '../pipeline-support';
import { readKnowledgeItemByRef, resolveKnowledgeItemId } from '../knowledge-read-tool';

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: jest.fn((name: string) => ({ name })),
}));

jest.mock('../store', () => ({
  getItem: jest.fn(),
  getCollection: jest.fn(),
}));

jest.mock('../pipeline-support', () => ({
  loadFullItemContent: jest.fn(),
}));

const getItemMock = store.getItem as jest.MockedFunction<typeof store.getItem>;
const getCollectionMock = store.getCollection as jest.MockedFunction<typeof store.getCollection>;
const loadFullItemContentMock = loadFullItemContent as jest.MockedFunction<typeof loadFullItemContent>;

describe('knowledge read tool helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolves kb_uri and raw ids', () => {
    expect(resolveKnowledgeItemId('kb://item/item-123')).toBe('item-123');
    expect(resolveKnowledgeItemId('kb:item:item-456')).toBe('item-456');
    expect(resolveKnowledgeItemId('raw-id')).toBe('raw-id');
    expect(resolveKnowledgeItemId('kb://item/has%20space')).toBeNull();
  });

  test('reads full text from reconstructed chunk content with paging metadata', () => {
    getItemMock.mockReturnValue({
      id: 'item-1',
      collection_id: 'collection-1',
      title: 'Doc',
      source_type: 'webpage',
      source_path: 'https://example.com/doc',
      source_key: 'webpage:https://example.com/doc',
      content: 'preview',
      tags: JSON.stringify(['tag-a']),
      doc_date: '',
      summary: 'summary',
      summary_embedding: null,
      health_status: 'healthy',
      reference_count: 0,
      chunk_count: 2,
      processing_status: 'ready',
      processing_detail: '{}',
      processing_error: '',
      processing_updated_at: null,
      created_at: '',
      updated_at: '',
    });
    getCollectionMock.mockReturnValue({
      id: 'collection-1',
      name: 'Knowledge',
      description: '',
      created_at: '',
      updated_at: '',
    });
    loadFullItemContentMock.mockReturnValue('0123456789');

    const result = readKnowledgeItemByRef({
      kbUri: 'kb://item/item-1',
      offset: 3,
      maxChars: 4,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toBe('3456');
      expect(result.total_chars).toBe(10);
      expect(result.has_more).toBe(true);
      expect(result.next_offset).toBe(7);
      expect(result.collection_name).toBe('Knowledge');
      expect(result.tags).toEqual(['tag-a']);
    }
  });
});
