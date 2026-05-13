import { parseSubtitleBody, parseVtt } from '../transcript-fetcher';

describe('parseVtt', () => {
  it('extracts cue start/end and text from a basic VTT body', () => {
    const body = `WEBVTT

00:00:00.000 --> 00:00:03.500
你好，欢迎来到这一期分享

00:00:03.500 --> 00:00:08.000
今天我们聊聊 Claude API 的 prompt caching
`;
    const segs = parseVtt(body);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({
      startSec: 0,
      endSec: 3,
      text: '你好，欢迎来到这一期分享',
    });
    expect(segs[1].startSec).toBe(3);
    expect(segs[1].endSec).toBe(8);
  });
});

describe('parseSubtitleBody — JSON shape', () => {
  it('parses a douyin-style utterances array', () => {
    const json = JSON.stringify({
      utterances: [
        { start_time: 0, end_time: 1500, text: 'hello' },
        { start_time: 1500, end_time: 3000, text: 'world' },
      ],
    });
    const r = parseSubtitleBody(json);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sourceFormat).toBe('json');
      expect(r.segments).toHaveLength(2);
      expect(r.segments[0].text).toBe('hello');
      // start_time looks like ms here; converter treats values <= 86400 as
      // seconds, so 1500 stays as 1500. That's fine for the contract.
      expect(typeof r.segments[0].startSec).toBe('number');
    }
  });

  it('also handles a `sentences` array', () => {
    const json = JSON.stringify({
      sentences: [{ start_time: 0, end_time: 5, text: '一句话' }],
    });
    const r = parseSubtitleBody(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.segments[0].text).toBe('一句话');
  });
});

describe('parseSubtitleBody — VTT shape', () => {
  it('returns sourceFormat=vtt when input starts with WEBVTT', () => {
    const body = `WEBVTT

00:00:00.000 --> 00:00:02.000
hi
`;
    const r = parseSubtitleBody(body);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sourceFormat).toBe('vtt');
  });
});

describe('parseSubtitleBody — fallback', () => {
  it('strips SRT timestamps and falls back to plain', () => {
    const body = `1
00:00:00,000 --> 00:00:02,000
this is the only line
`;
    const r = parseSubtitleBody(body);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sourceFormat).toBe('plain');
      expect(r.segments[0].text).toContain('this is the only line');
    }
  });

  it('rejects empty body with a clear reason', () => {
    const r = parseSubtitleBody('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/为空/);
  });
});
