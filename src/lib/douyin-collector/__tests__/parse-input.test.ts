import { parseDouyinInput } from '../parse-input';

describe('parseDouyinInput', () => {
  it('parses sec_uid string', () => {
    const r = parseDouyinInput('MS4wLjABAAAAabcDEF1234567890ZZ');
    expect(r.kind).toBe('sec_uid');
    if (r.kind === 'sec_uid') expect(r.secUid).toBe('MS4wLjABAAAAabcDEF1234567890ZZ');
  });

  it('parses profile URL with sec_uid', () => {
    const r = parseDouyinInput(
      'https://www.douyin.com/user/MS4wLjABAAAAabcDEF1234567890ZZ?from=test',
    );
    expect(r.kind).toBe('profile-url');
    if (r.kind === 'profile-url') expect(r.secUid).toBe('MS4wLjABAAAAabcDEF1234567890ZZ');
  });

  // kind 从 'video-url' 改成 'aweme' + contentKind(#55):形态与内容类型是两个
  // 正交维度,乘在一起会让 note/live/短链的组合爆炸。详见 parse-input.ts 顶部。
  it('parses video URL with aweme id', () => {
    const r = parseDouyinInput('https://www.douyin.com/video/7321234567890123456');
    expect(r.kind).toBe('aweme');
    if (r.kind === 'aweme') {
      expect(r.awemeId).toBe('7321234567890123456');
      expect(r.contentKind).toBe('video');
    }
  });

  it('parses short link as short-url for later resolution', () => {
    const r = parseDouyinInput('https://v.douyin.com/iAbCdEfG/');
    expect(r.kind).toBe('short-url');
    if (r.kind === 'short-url') expect(r.shortToken).toBe('iAbCdEfG');
  });

  it('extracts a short link from Douyin app share card text', () => {
    const r = parseDouyinInput(
      '9- 长按复制此条消息，打开抖音搜索，查看TA的更多作品。 https://v.douyin.com/GWZM5YWSYuY/ 0@8.com :1pm',
    );
    expect(r.kind).toBe('short-url');
    if (r.kind === 'short-url') expect(r.shortToken).toBe('GWZM5YWSYuY');
  });

  it('parses iesdouyin share profile URLs', () => {
    const r = parseDouyinInput(
      'https://www.iesdouyin.com/share/user/MS4wLjABAAAAabcDEF1234567890ZZ?from_user_page=1',
    );
    expect(r.kind).toBe('profile-url');
    if (r.kind === 'profile-url') expect(r.secUid).toBe('MS4wLjABAAAAabcDEF1234567890ZZ');
  });

  it('parses bare aweme id', () => {
    const r = parseDouyinInput('7321234567890123456');
    expect(r.kind).toBe('aweme');
  });

  it('returns unknown for empty / unrelated', () => {
    expect(parseDouyinInput('').kind).toBe('unknown');
    expect(parseDouyinInput('https://google.com').kind).toBe('unknown');
    expect(parseDouyinInput('hello world').kind).toBe('unknown');
  });
});

// #55:图文 note 走 /note/<id>,和视频共用同一套 aweme_id 体系,但解析层只认
// /video/ —— note 一律落进 unknown,下游于是回「需要抖音视频链接」,把"这类内容
// 不支持"说成了"你链接给错了",因果方向是反的。
describe('图文 note(#55)', () => {
  const NOTE_URL = 'https://www.douyin.com/note/7636725615005044008?previous_page=app_code_link';

  it('note 链接要被认成一条作品,不能落到 unknown', () => {
    expect(parseDouyinInput(NOTE_URL).kind).not.toBe('unknown');
  });

  it('note 链接要能取出 aweme_id', () => {
    const r = parseDouyinInput(NOTE_URL);
    expect(r).toMatchObject({ awemeId: '7636725615005044008' });
  });

  it('note 与 video 要能区分开,不能混成一种', () => {
    const note = parseDouyinInput(NOTE_URL);
    const video = parseDouyinInput('https://www.douyin.com/video/7321234567890123456');
    expect(note).toMatchObject({ contentKind: 'note' });
    expect(video).toMatchObject({ contentKind: 'video' });
  });

  // 裸 ID 现在被无条件当成视频。图文和视频共用 ID 体系,所以这个假设本来就不成立
  // —— 用户丢一个图文的裸 ID 进来,照样会被送进视频链路。这个洞现在就有,只是没人报。
  it('裸 aweme_id 的内容类型是待定的,不能默认当视频', () => {
    const r = parseDouyinInput('7321234567890123456');
    expect(r).toMatchObject({ contentKind: null });
  });

  it('note 的分享文案(带短链)照常先解析成短链,类型留到展开后判定', () => {
    const share = '0.79 复制打开抖音，看看【算法欧巴的图文作品】claude code上下文压缩有几层？'
      + ' https://v.douyin.com/M_2C_JqNdZs/ :6pm t@E.Ul 04/10 kpq:/';
    const r = parseDouyinInput(share);
    expect(r.kind).toBe('short-url');
    if (r.kind === 'short-url') expect(r.shortToken).toBe('M_2C_JqNdZs');
  });
});
