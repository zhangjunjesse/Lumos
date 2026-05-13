import { extractCreatorFromRenderData } from '../scraper';

const FIXTURE = {
  app: {
    pageData: {
      user: {
        sec_uid: 'MS4wLjABAAAAtest1234',
        nickname: 'AI 实践者',
        follower_count: 12345,
        avatar_thumb: { url_list: ['https://avatar.example/x.jpg'] },
      },
      post_list: [
        {
          aweme_id: '7000000000000000001',
          desc: '视频一',
          duration: 60_000,
          video: {
            cover: { url_list: ['https://cover.example/1.jpg'] },
            duration: 60_000,
          },
          author: { nickname: 'AI 实践者', sec_uid: 'MS4wLjABAAAAtest1234' },
        },
        {
          aweme_id: '7000000000000000002',
          desc: '视频二',
          duration: 1_800_000,
          video: { duration: 1_800_000 },
          author: { nickname: 'AI 实践者', sec_uid: 'MS4wLjABAAAAtest1234' },
        },
      ],
    },
  },
};

describe('extractCreatorFromRenderData', () => {
  it('finds the user node and returns nickname / follower_count / avatar', () => {
    const profile = extractCreatorFromRenderData(FIXTURE, 'MS4wLjABAAAAtest1234');
    expect(profile).toBeTruthy();
    expect(profile?.nickname).toBe('AI 实践者');
    expect(profile?.followerCount).toBe(12345);
    expect(profile?.avatar).toBe('https://avatar.example/x.jpg');
  });

  it('extracts the post_list as ScrapedVideoMetadata array, deduped by aweme_id', () => {
    const profile = extractCreatorFromRenderData(FIXTURE, 'MS4wLjABAAAAtest1234');
    expect(profile?.videos).toHaveLength(2);
    expect(profile?.videos[0].awemeId).toBe('7000000000000000001');
    expect(profile?.videos[0].title).toBe('视频一');
    expect(profile?.videos[0].duration).toBe(60);
    expect(profile?.videos[1].duration).toBe(1800);
  });

  it('returns null when no user and no videos can be found', () => {
    const profile = extractCreatorFromRenderData(
      { app: { pageData: {} } },
      'unknown-uid',
    );
    expect(profile).toBeNull();
  });

  it('still returns videos when user node is missing but post_list is present', () => {
    const data = {
      videoList: [
        { aweme_id: 'a1', desc: 't', author: {}, video: {} },
        { awemeId: 'a2', desc: 't2', author: {}, video: {} },
      ],
    };
    const profile = extractCreatorFromRenderData(data, 'MS4wLjxxx');
    expect(profile).toBeTruthy();
    expect(profile?.nickname).toBeNull();
    expect(profile?.videos).toHaveLength(2);
  });
});
