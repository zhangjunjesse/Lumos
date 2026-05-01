import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractInlineAttachments } from '../extract-inline-attachments';

let mediaDir: string;
let pngPath: string;
let pngBytes: Buffer;

beforeAll(() => {
  // Wrap a real `.lumos-media` directory inside a per-run temp parent so the
  // sandbox check (`/.lumos-media/`) actually matches.
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-extract-test-'));
  mediaDir = path.join(parent, '.lumos-media');
  fs.mkdirSync(mediaDir, { recursive: true });
  // PNG header + a few bytes — magic-byte detection isn't required here, the
  // helper trusts the file extension; we just need readable bytes.
  pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
  ]);
  pngPath = path.join(mediaDir, 'test.png');
  fs.writeFileSync(pngPath, pngBytes);
});

afterAll(() => {
  try { fs.rmSync(mediaDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('extractInlineAttachments', () => {
  test('returns empty when no markdown image', () => {
    const r = extractInlineAttachments('just plain text');
    expect(r.cleanText).toBe('just plain text');
    expect(r.attachments).toEqual([]);
  });

  test('extracts /api/media/serve?path=ENCODED', () => {
    const url = `/api/media/serve?path=${encodeURIComponent(pngPath)}`;
    const text = `Here is the picture you asked for:\n\n![cute cat](${url})\n\nLet me know.`;
    const r = extractInlineAttachments(text);

    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0].type).toBe('image/png');
    expect(r.attachments[0].size).toBe(pngBytes.length);
    expect(r.attachments[0].data).toBe(pngBytes.toString('base64'));
    expect(r.attachments[0].filePath).toBe(pngPath);

    // alt text replaces the markdown image
    expect(r.cleanText).toContain('[图片: cute cat]');
    expect(r.cleanText).not.toContain('![');
    expect(r.cleanText).toContain('Let me know.');
  });

  test('extracts direct absolute path inside .lumos-media', () => {
    const text = `before\n\n![](${pngPath})\n\nafter`;
    const r = extractInlineAttachments(text);
    expect(r.attachments).toHaveLength(1);
    // empty alt → "[图片]" placeholder
    expect(r.cleanText).toContain('[图片]');
    expect(r.cleanText).not.toContain('![');
  });

  test('leaves remote URLs alone', () => {
    const text = '![remote](https://example.com/cat.png)';
    const r = extractInlineAttachments(text);
    expect(r.attachments).toEqual([]);
    expect(r.cleanText).toBe(text);
  });

  test('rejects paths outside the lumos-media sandbox', () => {
    const escape = `/etc/passwd`;
    const url = `/api/media/serve?path=${encodeURIComponent(escape)}`;
    const text = `![](${url})`;
    const r = extractInlineAttachments(text);
    expect(r.attachments).toEqual([]);
    expect(r.cleanText).toBe(text);
  });

  test('handles multiple images in one reply', () => {
    const url1 = `/api/media/serve?path=${encodeURIComponent(pngPath)}`;
    const text = `Two images:\n![one](${url1})\nand\n![two](${pngPath})`;
    const r = extractInlineAttachments(text);
    expect(r.attachments).toHaveLength(2);
    expect(r.cleanText).toContain('[图片: one]');
    expect(r.cleanText).toContain('[图片: two]');
  });

  test('skips missing file but keeps the markdown', () => {
    const ghost = path.join(mediaDir, 'ghost.png');
    const text = `![](${ghost})`;
    const r = extractInlineAttachments(text);
    expect(r.attachments).toEqual([]);
    expect(r.cleanText).toBe(text);
  });
});
