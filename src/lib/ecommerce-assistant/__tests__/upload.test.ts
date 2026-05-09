import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { persistUploadedImage } from '../upload';

describe('persistUploadedImage', () => {
  let originalEnv: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    originalEnv = process.env.LUMOS_DATA_DIR;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-upload-test-'));
    process.env.LUMOS_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    process.env.LUMOS_DATA_DIR = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists a valid PNG into the upload dir', async () => {
    // PNG magic bytes (89 50 4E 47 0D 0A 1A 0A) + filler
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    const file = new File([buf], 'main.png', { type: 'image/png' });
    const result = await persistUploadedImage(file);
    expect(result.absolutePath).toMatch(/\.lumos-uploads\/ecommerce-assistant\//);
    expect(fs.existsSync(result.absolutePath)).toBe(true);
    expect(result.size).toBe(buf.length);
    expect(result.mimeType).toBe('image/png');
  });

  it('rejects files that are not real images (magic-byte mismatch)', async () => {
    const buf = Buffer.from('not-actually-a-png-file', 'utf-8');
    const file = new File([buf], 'evil.png', { type: 'image/png' });
    await expect(persistUploadedImage(file)).rejects.toThrow(/魔术字节/);
  });

  it('rejects files larger than 12MB', async () => {
    const big = Buffer.alloc(13 * 1024 * 1024);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
    const file = new File([big], 'huge.jpg', { type: 'image/jpeg' });
    await expect(persistUploadedImage(file)).rejects.toThrow(/超出上限/);
  });

  it('rejects empty files', async () => {
    const file = new File([new Uint8Array()], 'empty.png', { type: 'image/png' });
    await expect(persistUploadedImage(file)).rejects.toThrow(/为空/);
  });

  it('rejects unsupported extensions (e.g. .pdf)', async () => {
    const buf = Buffer.from('not-an-image');
    const file = new File([buf], 'doc.pdf', { type: 'application/pdf' });
    await expect(persistUploadedImage(file)).rejects.toThrow(/不支持的图片格式/);
  });

  it('infers extension when filename lacks one (still requires real PNG bytes)', async () => {
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    const file = new File([buf], 'noext', { type: 'image/png' });
    const result = await persistUploadedImage(file);
    expect(result.absolutePath.endsWith('.png')).toBe(true);
  });

  it('honors LUMOS_DATA_DIR override', async () => {
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(64),
    ]);
    const file = new File([buf], 'p.jpg', { type: 'image/jpeg' });
    const result = await persistUploadedImage(file);
    expect(result.absolutePath.startsWith(tmpDir)).toBe(true);
  });
});
