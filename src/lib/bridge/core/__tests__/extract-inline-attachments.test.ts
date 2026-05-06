import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractInlineAttachments, extractInlineAttachmentsForIm } from '../extract-inline-attachments';

let mediaDir: string;
let pngPath: string;
let pngBytes: Buffer;
const originalFetch = global.fetch;

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
  global.fetch = originalFetch;
  try { fs.rmSync(mediaDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  global.fetch = originalFetch;
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

  test('extracts remote markdown image for IM delivery', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      headers: {
        get: (key: string) => {
          if (key.toLowerCase() === 'content-type') return 'image/png';
          if (key.toLowerCase() === 'content-length') return String(pngBytes.length);
          return null;
        },
      },
      arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const text = '发这张图：![cat](https://cdn.example.com/cat.png)';
    const r = await extractInlineAttachmentsForIm(text);

    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0]).toMatchObject({
      name: 'cat.png',
      type: 'image/png',
      size: pngBytes.length,
      data: pngBytes.toString('base64'),
    });
    expect(r.cleanText).toBe('发这张图：[图片: cat]');
  });

  test('extracts markdown image URL without image extension when response is image', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      headers: {
        get: (key: string) => key.toLowerCase() === 'content-type' ? 'image/png' : null,
      },
      arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await extractInlineAttachmentsForIm('![generated](https://cdn.example.com/render?id=1)');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0].name).toBe('render.png');
    expect(r.cleanText).toBe('[图片: generated]');
  });

  test('extracts bare remote image URL for IM delivery', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      headers: {
        get: (key: string) => key.toLowerCase() === 'content-type' ? 'image/jpeg' : null,
      },
      arrayBuffer: async () => {
        const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await extractInlineAttachmentsForIm('图片在这里 https://cdn.example.com/a/b/photo.jpg 。');

    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0].name).toBe('photo.jpg');
    expect(r.attachments[0].type).toBe('image/jpeg');
    expect(r.cleanText).toContain('[图片: photo.jpg]');
    expect(r.cleanText).not.toContain('https://cdn.example.com');
  });

  test('extracts remote image from ordinary markdown link without corrupting syntax', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      headers: {
        get: (key: string) => key.toLowerCase() === 'content-type' ? 'image/png' : null,
      },
      arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await extractInlineAttachmentsForIm('点这里看：[图一](https://cdn.example.com/img/pic.png)');

    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0].name).toBe('pic.png');
    expect(r.cleanText).toBe('点这里看：[图片: 图一]');
    expect(r.cleanText).not.toContain(']([图片:');
  });

  test('keeps remote image markdown when download fails', async () => {
    const fetchMock = jest.fn(async () => ({ ok: false }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const text = '![remote](https://cdn.example.com/missing.png)';
    const r = await extractInlineAttachmentsForIm(text);

    expect(r.attachments).toEqual([]);
    expect(r.cleanText).toBe(text);
  });

  test('does not fetch blocked local hosts', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const text = '![local](http://127.0.0.1/private.png)';
    const r = await extractInlineAttachmentsForIm(text);

    expect(fetchMock).not.toHaveBeenCalled();
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

  test('extracts office file via plain markdown link', () => {
    const docPath = path.join(mediaDir, 'report.docx');
    const docBytes = Buffer.from('PK\x03\x04 fake docx');
    fs.writeFileSync(docPath, docBytes);

    const text = `Here's the report you asked for: [报告.docx](${docPath})\n\nLet me know.`;
    const r = extractInlineAttachments(text);
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0].name).toBe('report.docx');
    expect(r.attachments[0].type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(r.attachments[0].size).toBe(docBytes.length);
    expect(r.cleanText).toContain('[文件: 报告.docx]');
    expect(r.cleanText).not.toContain(docPath);
  });

  test('extracts pdf via /api/uploads URL', () => {
    const pdfPath = path.join(mediaDir, 'invoice.pdf');
    const pdfBytes = Buffer.from('%PDF-1.4\n');
    fs.writeFileSync(pdfPath, pdfBytes);

    const url = `/api/uploads?path=${encodeURIComponent(pdfPath)}`;
    const text = `Invoice: [open](${url})`;
    const r = extractInlineAttachments(text);
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0].type).toBe('application/pdf');
    expect(r.attachments[0].name).toBe('invoice.pdf');
  });

  test('image markdown does not double-extract under link rule', () => {
    const url = `/api/media/serve?path=${encodeURIComponent(pngPath)}`;
    const text = `![cat](${url})`;
    const r = extractInlineAttachments(text);
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0].type).toBe('image/png');
  });

  test('mixes one image and one office doc', () => {
    const docPath = path.join(mediaDir, 'note.txt');
    fs.writeFileSync(docPath, 'hello');
    const text = `![pic](${pngPath}) and [note](${docPath})`;
    const r = extractInlineAttachments(text);
    expect(r.attachments).toHaveLength(2);
    expect(r.attachments[0].type).toBe('image/png');
    expect(r.attachments[1].type).toBe('text/plain');
    expect(r.cleanText).toContain('[图片: pic]');
    expect(r.cleanText).toContain('[文件: note]');
  });
});
