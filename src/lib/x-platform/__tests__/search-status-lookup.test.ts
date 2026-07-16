jest.mock('../scraper', () => ({
  ensureScraper: jest.fn(),
}));

import { ensureScraper } from '../scraper';
import { searchTweets } from '../search';

const mockedEnsureScraper = ensureScraper as jest.MockedFunction<typeof ensureScraper>;
const statusId = '2076261029840052651';

describe('x-platform status lookup', () => {
  beforeEach(() => {
    mockedEnsureScraper.mockReset();
  });

  test.each([
    statusId,
    `https://x.com/Stanleysobest/status/${statusId}?s=20`,
  ])('reads a status directly for %s', async (query) => {
    const getTweet = jest.fn().mockResolvedValue({
      id: statusId,
      username: 'Stanleysobest',
      text: 'existing tweet',
    });
    mockedEnsureScraper.mockResolvedValue({ getTweet } as never);

    const result = await searchTweets(query);

    expect(getTweet).toHaveBeenCalledWith(statusId);
    expect(result.hits[0]?.id).toBe(statusId);
  });

  test('reports an inaccessible status instead of returning empty search hits', async () => {
    mockedEnsureScraper.mockResolvedValue({
      getTweet: jest.fn().mockResolvedValue(undefined),
    } as never);

    await expect(searchTweets(statusId)).rejects.toThrow('不存在或当前登录态无权访问');
  });
});
