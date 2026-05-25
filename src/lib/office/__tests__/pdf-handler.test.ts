import fs from 'fs';
import os from 'os';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { containsCjk, createPdf, wrapText } from '../pdf-handler';

const TMP_ROOT = path.join(os.tmpdir(), `lumos-pdf-handler-${process.pid}`);

beforeAll(() => { fs.mkdirSync(TMP_ROOT, { recursive: true }); });
afterAll(() => { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); });

describe('containsCjk', () => {
  it('detects Han characters', () => { expect(containsCjk('你好')).toBe(true); });
  it('detects Japanese kana', () => { expect(containsCjk('カタカナ')).toBe(true); });
  it('returns false for pure Latin', () => { expect(containsCjk('hello world')).toBe(false); });
});

describe('wrapText', () => {
  // Mock font: every character is 10px wide regardless of font size.
  const monoFont = { widthOfTextAtSize: (t: string) => t.length * 10 };

  it('wraps Latin text on word boundaries', () => {
    const lines = wrapText('the quick brown fox', monoFont, 1, 100);
    expect(lines.every(l => l.length <= 10)).toBe(true);
  });

  it('breaks CJK runs per-character when no spaces are available (regression)', () => {
    // 5 CJK chars = 50px wide @ 10px/char, maxWidth=30 → 3 chars/line
    const lines = wrapText('你好世界今', monoFont, 1, 30);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(3);
    expect(lines.join('')).toBe('你好世界今');
  });

  it('preserves paragraph breaks', () => {
    const lines = wrapText('one\ntwo', monoFont, 1, 100);
    expect(lines).toEqual(['one', 'two']);
  });

  it('falls back to char-wrap when a single word exceeds the line width', () => {
    // a 50-char Latin "word" with no spaces at maxWidth=30 should char-break.
    const lines = wrapText('a'.repeat(50), monoFont, 1, 30);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(3);
    expect(lines.join('')).toBe('a'.repeat(50));
  });
});

describe('createPdf', () => {
  it('produces a PDF for pure Latin content using built-in fonts', async () => {
    const out = path.join(TMP_ROOT, 'latin.pdf');
    await createPdf({
      filePath: out,
      title: 'Test',
      pages: [{ blocks: [{ text: 'Hello world', fontSize: 12 }] }],
    });
    const bytes = fs.readFileSync(out);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('produces a PDF for CJK content without throwing WinAnsi errors (regression)', async () => {
    const out = path.join(TMP_ROOT, 'cjk.pdf');
    await createPdf({
      filePath: out,
      title: '会议录音转文字',
      pages: [{
        blocks: [
          { text: '会议录音转文字', fontSize: 18, bold: true },
          { text: '嗯。然后从数据库里面去提出的。数据库查询安全管控等。', fontSize: 10 },
        ],
      }],
    });
    const bytes = fs.readFileSync(out);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // CJK font is ~6MB even after subsetting; a Helvetica-only PDF is < 5KB.
    // Smoke check that we actually embedded the CJK face.
    expect(bytes.byteLength).toBeGreaterThan(50_000);
  });

  it('handles mixed Latin + CJK in the same page', async () => {
    const out = path.join(TMP_ROOT, 'mixed.pdf');
    await createPdf({
      filePath: out,
      pages: [{ blocks: [{ text: 'Hello 世界, mixed line.', fontSize: 12 }] }],
    });
    expect(fs.existsSync(out)).toBe(true);
  });
});
