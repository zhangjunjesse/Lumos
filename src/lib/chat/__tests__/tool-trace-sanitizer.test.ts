import { stripLeakedToolTraceText } from '../tool-trace-sanitizer';

describe('stripLeakedToolTraceText', () => {
  it('removes leaked tool-use and tool-result markers from visible text', () => {
    const raw = [
      '我先采集这个视频。',
      '[Used tool: mcp__douyin-collector__douyin_collect_video]',
      '[Tool result: {"ok":true,"tags":["跨境电商","眼镜"],"video":{"title":"Hayden"}}]',
      '采集完成，下面是摘要。',
    ].join(' ');

    expect(stripLeakedToolTraceText(raw)).toBe('我先采集这个视频。采集完成，下面是摘要。');
  });

  it('does not alter normal text when no internal marker is present', () => {
    const raw = '采集完成：这条视频讨论跨境电商眼镜产品。';
    expect(stripLeakedToolTraceText(raw)).toBe(raw);
  });
});
