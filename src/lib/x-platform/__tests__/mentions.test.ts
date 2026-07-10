/**
 * searchMyMentions: 无用户名时抛 unset;有用户名时把 `@handle` 交给标准搜索
 * (Latest 时间倒序)。搜索与身份都 mock 掉,只验证编排。
 */
describe('mentions.searchMyMentions', () => {
  beforeEach(() => jest.resetModules());
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('no screen name → throws unset', async () => {
    class XScreenNameUnsetError extends Error { readonly code = 'X_SCREEN_NAME_UNSET'; }
    jest.doMock('../identity', () => ({ getMyScreenName: () => '', XScreenNameUnsetError }));
    jest.doMock('../search', () => ({ searchTweets: jest.fn() }));
    const { searchMyMentions } = await import('../mentions');
    await expect(searchMyMentions()).rejects.toMatchObject({ code: 'X_SCREEN_NAME_UNSET' });
  });

  test('with screen name → searches @handle in Latest mode', async () => {
    const searchTweets = jest.fn(async () => ({ query: '@Me', hits: [], returnedCount: 0 }));
    class XScreenNameUnsetError extends Error {}
    jest.doMock('../identity', () => ({ getMyScreenName: () => 'Me', XScreenNameUnsetError }));
    jest.doMock('../search', () => ({ searchTweets }));
    const { searchMyMentions } = await import('../mentions');
    const res = await searchMyMentions({ count: 10 });
    expect(searchTweets).toHaveBeenCalledWith('@Me', expect.objectContaining({ mode: 'Latest', count: 10 }));
    expect(res.screenName).toBe('Me');
  });
});
