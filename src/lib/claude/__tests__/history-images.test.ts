import { extractHistoryImages } from '../history-images';
import type { HistoryMessage } from '../history-normalizer';

// Mirror the real DB shape: an assistant message's content is a JSON blocks
// string, and a tool_result's `content` is itself another serialized
// content-blocks string (image-reader's image block lives in there).
function imgBlock(mediaType: string, data: string) {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

function readImageMessage(blocks: object[]): HistoryMessage {
  return {
    role: 'assistant',
    content: JSON.stringify([
      { type: 'tool_use', id: 'c1', name: 'mcp__image-reader__read_image', input: { path: 'x.png' } },
      { type: 'tool_result', tool_use_id: 'c1', content: JSON.stringify(blocks), is_error: false },
    ]),
  };
}

describe('extractHistoryImages', () => {
  it('returns empty for missing or empty history', () => {
    expect(extractHistoryImages(undefined)).toEqual([]);
    expect(extractHistoryImages([])).toEqual([]);
  });

  it('extracts an image block stored as a serialized tool_result string', () => {
    const history = [readImageMessage([
      imgBlock('image/png', 'AAAA'),
      { type: 'text', text: 'Loaded x.png (image/png, 1KB).' },
    ])];
    expect(extractHistoryImages(history)).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
  });

  it('ignores user messages and non-image tool_results', () => {
    const history: HistoryMessage[] = [
      { role: 'user', content: JSON.stringify([imgBlock('image/png', 'U')]) },
      { role: 'assistant', content: JSON.stringify([
        { type: 'tool_result', tool_use_id: 't', content: '{"stdout":"ok"}', is_error: false },
      ]) },
    ];
    expect(extractHistoryImages(history)).toEqual([]);
  });

  it('skips media types outside the vision allowlist', () => {
    const history = [readImageMessage([imgBlock('image/svg+xml', 'SVG')])];
    expect(extractHistoryImages(history)).toEqual([]);
  });

  it('keeps only the most recent N images, returned chronologically', () => {
    const history = [
      readImageMessage([imgBlock('image/png', 'OLD')]),
      readImageMessage([imgBlock('image/png', 'MID')]),
      readImageMessage([imgBlock('image/png', 'NEW')]),
    ];
    expect(extractHistoryImages(history, 2)).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'MID' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'NEW' } },
    ]);
  });

  it('respects the byte budget', () => {
    const big = 'x'.repeat(100);
    const history = [readImageMessage([imgBlock('image/png', big)])];
    expect(extractHistoryImages(history, 3, 50)).toEqual([]);
  });

  it('handles already-parsed array content, not just strings', () => {
    const history: HistoryMessage[] = [{
      role: 'assistant',
      content: JSON.stringify([
        {
          type: 'tool_result',
          tool_use_id: 'c1',
          content: [imgBlock('image/jpeg', 'JJ'), { type: 'text', text: 'x' }],
          is_error: false,
        },
      ]),
    }];
    expect(extractHistoryImages(history)).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'JJ' } },
    ]);
  });
});
