jest.mock('../scraper', () => ({
  ensureScraper: jest.fn(),
}));

import { ensureScraper } from '../scraper';
import { searchTweets } from '../search';
import { readUserTweets } from '../timeline';
import { getTweetById, getTweetReplies } from '../thread';

const mockedEnsureScraper = ensureScraper as jest.MockedFunction<typeof ensureScraper>;

async function* neverYield(): AsyncGenerator<unknown> {
  await new Promise(() => undefined);
}

async function* yieldOneThenHang(): AsyncGenerator<unknown> {
  yield {
    id: '2052550322640568571',
    username: 'openai',
    name: 'OpenAI',
    userId: '100',
    text: 'hello',
    timestamp: 1_778_216_093,
  };
  await new Promise(() => undefined);
}

describe('x-platform read timeout', () => {
  beforeEach(() => {
    mockedEnsureScraper.mockReset();
  });

  test('searchTweets times out instead of waiting forever', async () => {
    mockedEnsureScraper.mockResolvedValue({
      searchTweets: () => neverYield(),
    } as never);

    await expect(searchTweets('openai', { count: 1, timeoutMs: 100 })).rejects.toThrow(/X 搜索\s*超时/);
  });

  test('searchTweets can return partial results for large collection timeouts', async () => {
    mockedEnsureScraper.mockResolvedValue({
      searchTweets: () => yieldOneThenHang(),
    } as never);

    const result = await searchTweets('openai', {
      count: 2,
      timeoutMs: 100,
      allowPartialOnTimeout: true,
    });

    expect(result.hits).toHaveLength(1);
    expect(result.partial).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(result.requestedCount).toBe(2);
    expect(result.returnedCount).toBe(1);
  });

  test('readUserTweets times out instead of waiting forever', async () => {
    mockedEnsureScraper.mockResolvedValue({
      getTweets: () => neverYield(),
    } as never);

    await expect(readUserTweets('openai', { count: 1, timeoutMs: 100 })).rejects.toThrow(/X 用户时间线\s*超时/);
  });

  test('readUserTweets supports large explicit counts', async () => {
    const getTweets = jest.fn(() => (async function* empty() {})());
    mockedEnsureScraper.mockResolvedValue({
      getTweets,
    } as never);

    const result = await readUserTweets('openai', { count: 500, timeoutMs: 100 });

    expect(getTweets).toHaveBeenCalledWith('openai', 500);
    expect(result.requestedCount).toBe(500);
    expect(result.maxSupportedCount).toBe(1000);
  });

  test('getTweetById times out instead of waiting forever', async () => {
    mockedEnsureScraper.mockResolvedValue({
      getTweet: () => new Promise(() => undefined),
    } as never);

    await expect(getTweetById('1234567890', { timeoutMs: 100 })).rejects.toThrow(/X 推文详情\s*超时/);
  });

  test('getTweetReplies times out instead of waiting forever', async () => {
    mockedEnsureScraper.mockResolvedValue({
      searchTweets: () => neverYield(),
    } as never);

    await expect(getTweetReplies('1234567890', { count: 1, timeoutMs: 100 })).rejects.toThrow(/X 推文评论\s*超时/);
  });
});
