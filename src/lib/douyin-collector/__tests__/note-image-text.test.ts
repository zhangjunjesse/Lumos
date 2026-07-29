// OCR 质量闸(#55)。双路径方案(先 tesseract、不行回退模型)全靠这道闸成立 ——
// 没有它,「跑通了但结果是垃圾」会被当成成功,乱码一路进总结、进知识库。

import { judgeOcrQuality } from '../note-image-text';

describe('judgeOcrQuality', () => {
  it('正常的中文识别结果放行', () => {
    const text = '这是一段正常识别出来的中文内容，讲的是上下文压缩分成几层，'
      + '以及每一层各自负责什么。';
    expect(judgeOcrQuality(text)).toEqual({ usable: true });
  });

  it('正常的英文识别结果放行', () => {
    const text = 'This is a normal OCR result with enough readable characters to pass.';
    expect(judgeOcrQuality(text)).toEqual({ usable: true });
  });

  it('空结果不可用', () => {
    expect(judgeOcrQuality('').usable).toBe(false);
    expect(judgeOcrQuality('   \n  ').usable).toBe(false);
  });

  // 旧的 OCR 判据是「≥10 个字符就算成功」—— 10 个乱码字符照样通过。
  it('字符太少不可用(旧判据 length>=10 挡不住的那一类)', () => {
    const verdict = judgeOcrQuality('少量字符');
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toContain('太少');
  });

  it('乱码占比过高判定失败 —— 这是抖音艺术字图的典型输出', () => {
    const verdict = judgeOcrQuality('◇▽※§¶†‡◆●■▲▼◀▶☆♪♫♬✚✜✛✢✣✤✥ ▒▓█▄▀░');
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toContain('乱码');
  });

  it('碎成单字的排版判定失败', () => {
    // 字数要够多才走得到碎片判据 —— 太短的会先被「字符太少」拦下(那条也对,
    // 只是测不到这里想锁的东西)。
    const verdict = judgeOcrQuality('上下文压缩分成三层每层各管一段这里故意排成单字'.split('').join('\n'));
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toContain('碎');
  });

  it('行数不够多时不套用碎片判据(避免误杀短标题)', () => {
    const verdict = judgeOcrQuality('这是一段够长的正常文字内容，用来确认短文本不会被碎片判据误杀。\nA\nB');
    expect(verdict.usable).toBe(true);
  });

  it('中英混排的正常结果放行', () => {
    const text = 'Claude Code 的上下文压缩分为 3 层：micro-compact、auto-compact 和手动 /compact。';
    expect(judgeOcrQuality(text)).toEqual({ usable: true });
  });

  it('常见标点不算乱码', () => {
    const text = '第一层：自动压缩（auto-compact）；第二层：手动触发——也就是 /compact 命令、'
      + '第三层「微压缩」…… 这些都属于正常标点。';
    expect(judgeOcrQuality(text)).toEqual({ usable: true });
  });
});
