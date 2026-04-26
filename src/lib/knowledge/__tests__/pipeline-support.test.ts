const getDbMock = jest.fn();

jest.mock('@/lib/db', () => ({
  getDb: () => getDbMock(),
}));

import {
  appendProcessingMessage,
  buildStoredPreviewContent,
  joinChunksDedupOverlap,
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

  describe('joinChunksDedupOverlap', () => {
    test('returns empty string when no chunks given', () => {
      expect(joinChunksDedupOverlap([])).toBe('');
    });

    test('returns the single chunk verbatim', () => {
      expect(joinChunksDedupOverlap(['hello'])).toBe('hello');
    });

    test('removes paragraph-aware sliding overlap with \\n\\n separator', () => {
      // Mirrors chunker.ts paragraph-aware path: chunk[i+1] starts with the
      // last `overlap` chars of chunk[i], followed by "\n\n", followed by new content.
      const chunkA = 'Para1 contents.\n\nPara2 ends with TAILTAIL';
      const overlap = 'TAILTAIL';
      const chunkB = `${overlap}\n\nPara3 begins here.\n\nPara4`;
      expect(joinChunksDedupOverlap([chunkA, chunkB])).toBe(
        'Para1 contents.\n\nPara2 ends with TAILTAIL\n\nPara3 begins here.\n\nPara4',
      );
    });

    test('removes forceChunk-style overlap without separator', () => {
      // forceChunk path: chunk[i+1] = text.slice(end_i - overlap, end_{i+1})
      // chunk[i+1] starts with last `overlap` chars of chunk[i]; no separator.
      const chunkA = 'AAAABBBBCCCCDDDDEEEE';
      const chunkB = 'DDDDEEEEFFFFGGGGHHHH';
      expect(joinChunksDedupOverlap([chunkA, chunkB])).toBe(
        'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH',
      );
    });

    test('falls back to paragraph join when adjacent chunks share no suffix-prefix', () => {
      expect(joinChunksDedupOverlap(['第一段', '完全独立的一段'])).toBe(
        '第一段\n\n完全独立的一段',
      );
    });

    test('handles three-chunk sequence with mixed overlap lengths', () => {
      const a = '开头部分' + 'X'.repeat(50);
      const b = 'X'.repeat(50) + '\n\n中间部分' + 'Y'.repeat(80);
      const c = 'Y'.repeat(80) + '\n\n结尾部分';
      expect(joinChunksDedupOverlap([a, b, c])).toBe(
        '开头部分' + 'X'.repeat(50) + '\n\n中间部分' + 'Y'.repeat(80) + '\n\n结尾部分',
      );
    });

    test('caps overlap probe so unrelated long shared substrings do not collapse content', () => {
      // Make chunkA longer than chunkB so the only matching length is far past the cap.
      const sharedFiller = 'Z'.repeat(500);
      const chunkA = 'unique start ' + sharedFiller;
      const chunkB = sharedFiller + ' unique end';
      // The shared substring (500 chars) exceeds the 200-char probe cap, so we
      // detect at most 200 chars of overlap — content remains usable, no false truncation.
      const joined = joinChunksDedupOverlap([chunkA, chunkB]);
      expect(joined.includes('unique start')).toBe(true);
      expect(joined.includes('unique end')).toBe(true);
    });
  });
});
