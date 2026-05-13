import type { AdapterContext } from '../adapter-types';
import type { XSearchHit } from '@/lib/x-platform/types';

const mockSearchTweets = jest.fn();

jest.mock('@/lib/x-platform/search', () => ({
  searchTweets: (...args: unknown[]) => mockSearchTweets(...args),
}));

jest.mock('@/lib/x-platform/thread', () => ({
  getTweetById: jest.fn(),
  getTweetReplies: jest.fn(),
}));

jest.mock('@/lib/x-platform/auth', () => ({
  getAuthStatus: jest.fn(),
}));

jest.mock('@/lib/x-platform/auth-error', () => ({
  isXAuthExpiredError: jest.fn(),
}));

import { xAdapter } from '../adapters/x';

function createHit(overrides?: Partial<XSearchHit>): XSearchHit {
  return {
    id: '2052550322640568571',
    authorId: '100',
    authorScreenName: 'builder',
    authorName: '出海 builder',
    text: 'AI 赚钱和出海产品讨论',
    createdAt: 1778216093000,
    likeCount: 171,
    retweetCount: 29,
    replyCount: 33,
    viewCount: 12400,
    bookmarkCount: 221,
    quoteCount: 7,
    conversationId: '2052550322640568571',
    photoUrls: ['https://example.com/a.jpg'],
    videoPreviewUrls: [],
    url: 'https://x.com/builder/status/2052550322640568571',
    ...overrides,
  };
}

describe('x deepsearch adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns tweet metrics in item extras and structured search data', async () => {
    mockSearchTweets.mockResolvedValue({
      query: 'AI赚钱',
      hits: [createHit()],
    });

    const result = await xAdapter.search({} as AdapterContext, 'AI赚钱', 3);
    const firstItem = result.items[0];
    const structured = result.structuredData as { items?: Array<Record<string, unknown>> };
    const structuredFirst = structured.items?.[0] as {
      metrics?: Record<string, unknown>;
      tweetId?: string;
    } | undefined;

    expect(firstItem?.extra).toMatchObject({
      tweetId: '2052550322640568571',
      likeCount: 171,
      retweetCount: 29,
      replyCount: 33,
      bookmarkCount: 221,
      quoteCount: 7,
      viewCount: 12400,
      metrics: {
        likeCount: 171,
        retweetCount: 29,
        replyCount: 33,
        bookmarkCount: 221,
        quoteCount: 7,
        viewCount: 12400,
      },
    });
    expect(firstItem?.snippet).toContain('❤171');
    expect(firstItem?.snippet).toContain('🔖221');
    expect(structuredFirst).toMatchObject({
      tweetId: '2052550322640568571',
      metrics: {
        likeCount: 171,
        retweetCount: 29,
        replyCount: 33,
        bookmarkCount: 221,
        quoteCount: 7,
        viewCount: 12400,
      },
    });
  });
});
