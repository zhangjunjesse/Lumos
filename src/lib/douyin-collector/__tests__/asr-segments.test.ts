import {
  buildApproximateAsrSegments,
  normalizeAsrSegmentsForDisplay,
  splitAsrTextIntoChunks,
} from '../asr-segments';

describe('asr-segments', () => {
  it('splits long ASR text into readable chunks', () => {
    const text = (
      '第一句很短。第二句也很短。第三句开始解释一个比较长的观点，需要继续说下去。第四句继续补充技术使用和人的关系。' +
      '第五句谈到战争机器和人性的制约。第六句继续说明科学技术的双刃剑。第七句补充人会被自己的妄念遮蔽。第八句收束到禅宗修行的指引。'
    ).repeat(2);
    const chunks = splitAsrTextIntoChunks(
      text,
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toContain('第三句开始解释');
  });

  it('distributes approximate timestamps across the known duration', () => {
    const text = (
      '开场介绍。第一部分展开，说明科学技术不是天然造福人类。第二部分继续，说明工具如何被不同的心使用。第三部分转到战争机器和人的选择。' +
      '第四部分讨论人的上升和下坠。第五部分说明每个人都有两种可能性。第六部分继续讲心性被妄念遮蔽。结尾总结到禅宗修行。'
    ).repeat(2);
    const segments = buildApproximateAsrSegments(
      text,
      120,
    );

    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0].startSec).toBe(0);
    expect(segments[segments.length - 1].endSec).toBe(120);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startSec).toBeGreaterThanOrEqual(segments[i - 1].endSec);
    }
  });

  it('expands legacy one-blob ASR records for display without changing the text', () => {
    const text = (
      '第一段内容。第二段内容，继续补充一个比较长的观察。第三段内容，说明为什么原文不能只挤在开头。' +
      '第四段内容，继续讲用户在界面上会误以为后面没有字幕。第五段内容，收束到需要分段展示。第六段内容，确认旧记录也能直接展开。'
    ).repeat(2);
    const segments = normalizeAsrSegmentsForDisplay(
      [{ startSec: 0, endSec: 60, text }],
      60,
    );

    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
    expect(segments[segments.length - 1].endSec).toBe(60);
  });
});
