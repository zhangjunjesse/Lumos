import {
  hasLeakedToolInvocationText,
  stripLeakedToolTraceText,
} from '../tool-trace-sanitizer';

describe('stripLeakedToolTraceText', () => {
  it('removes leaked tool-use and tool-result markers from visible text', () => {
    const raw = [
      '我先采集这个视频。',
      '[Used tool: mcp__douyin-collector__douyin_collect]',
      '[Tool result: {"ok":true,"tags":["跨境电商","眼镜"],"video":{"title":"Hayden"}}]',
      '采集完成，下面是摘要。',
    ].join(' ');

    expect(stripLeakedToolTraceText(raw)).toBe('我先采集这个视频。采集完成，下面是摘要。');
  });

  it('does not alter normal text when no internal marker is present', () => {
    const raw = '采集完成：这条视频讨论跨境电商眼镜产品。';
    expect(stripLeakedToolTraceText(raw)).toBe(raw);
  });

  it('removes leaked Windows call command text without touching normal call wording', () => {
    const raw = '准备执行。\ncall echo "hello"\ncall true\n没有执行。';

    expect(hasLeakedToolInvocationText(raw)).toBe(true);
    expect(stripLeakedToolTraceText(raw)).toBe('准备执行。没有执行。');
    expect(stripLeakedToolTraceText('Please call me tomorrow.')).toBe('Please call me tomorrow.');
  });

  it('removes leaked XML-style function call text', () => {
    const raw = [
      '我来读取文件。',
      '<function_calls><invoke name="Read"><parameter name="file_path">/tmp/a.txt</parameter></invoke></function_calls>',
      '然后继续。',
    ].join('\n');

    expect(hasLeakedToolInvocationText(raw)).toBe(true);
    expect(stripLeakedToolTraceText(raw)).toBe('我来读取文件。然后继续。');
  });
});
