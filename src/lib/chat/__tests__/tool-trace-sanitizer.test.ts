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

// #60 / #61:超长中英混排回复被 court 守卫误判为"模型把工具调用当成文本输出",
// 整条回复被替换成报错。命令表里 type/set/copy/move/where 都是常用英文词,
// 中文叙述里出现在行首就会命中。
describe('中英混排的自然语言不该被当成工具调用泄漏', () => {
  const naturalLines = [
    'call type A 的处理方式如下,先读取再写入。',
    'call set 参数说明:这一步决定最终产出。',
    'call copy 一份到目标目录,保留原文件。',
    'call move 之后要记得更新索引。',
    'call where 用于定位可执行文件的位置。',
  ];

  it.each(naturalLines)('放行:%s', (line) => {
    expect(hasLeakedToolInvocationText(line)).toBe(false);
    expect(stripLeakedToolTraceText(line)).toBe(line);
  });

  it('真的泄漏(纯命令格式)仍然要拦', () => {
    expect(hasLeakedToolInvocationText('call echo "hello"')).toBe(true);
    expect(hasLeakedToolInvocationText('call true')).toBe(true);
    expect(hasLeakedToolInvocationText('call python train.py --epochs 3')).toBe(true);
  });

  it('同一段里中文叙述保留、纯命令行被剥掉', () => {
    const raw = 'call type A 的说明如下。\ncall echo "hello"\n结束。';
    const out = stripLeakedToolTraceText(raw);
    expect(out).toContain('call type A 的说明如下。');
    expect(out).not.toContain('call echo');
  });

  it('长中英混排派单正文(#61 复现条件)整体放行', () => {
    const longBrief = [
      '本轮出图任务分配如下,请严格按顺序执行。',
      '',
      '成员 A:负责主图 3 张,尺寸 1024x1024。',
      'call set 的风格参数保持与上一批一致。',
      '成员 B:负责场景图 3 张,注意光线统一。',
      '',
      '交付要求:每完成一张立即落盘,不要攒到最后统一拷贝。',
    ].join('\n').repeat(6);
    expect(hasLeakedToolInvocationText(longBrief)).toBe(false);
  });
});
