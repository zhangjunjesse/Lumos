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

  it('parses video URL with aweme id', () => {
    const r = parseDouyinInput('https://www.douyin.com/video/7321234567890123456');
    expect(r.kind).toBe('video-url');
    if (r.kind === 'video-url') expect(r.awemeId).toBe('7321234567890123456');
  });

  it('parses short link as short-url for later resolution', () => {
    const r = parseDouyinInput('https://v.douyin.com/iAbCdEfG/');
    expect(r.kind).toBe('short-url');
    if (r.kind === 'short-url') expect(r.shortToken).toBe('iAbCdEfG');
  });

  it('parses bare aweme id', () => {
    const r = parseDouyinInput('7321234567890123456');
    expect(r.kind).toBe('aweme_id');
  });

  it('returns unknown for empty / unrelated', () => {
    expect(parseDouyinInput('').kind).toBe('unknown');
    expect(parseDouyinInput('https://google.com').kind).toBe('unknown');
    expect(parseDouyinInput('hello world').kind).toBe('unknown');
  });
});
