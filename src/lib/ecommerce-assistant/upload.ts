import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_BYTES = 12 * 1024 * 1024;

function isLikelyImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // GIF: 47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50 (RIFF....WEBP)
  if (
    buf[0] === 0x52
    && buf[1] === 0x49
    && buf[2] === 0x46
    && buf[3] === 0x46
    && buf[8] === 0x57
    && buf[9] === 0x45
    && buf[10] === 0x42
    && buf[11] === 0x50
  ) return true;
  return false;
}

export function getEcommerceUploadDir(): string {
  const base = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
  // Reuse the .lumos-uploads/* path so the existing /api/uploads endpoint can serve previews.
  const dir = path.join(base, '.lumos-uploads', 'ecommerce-assistant');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface PersistedUpload {
  absolutePath: string;
  relativePath: string;
  size: number;
  mimeType: string;
}

export async function persistUploadedImage(file: File): Promise<PersistedUpload> {
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) throw new Error('上传文件为空。');
  if (buf.length > MAX_BYTES) {
    throw new Error(`文件超出上限（${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB）：${file.name}`);
  }
  const ext = path.extname(file.name || '').toLowerCase() || '.png';
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`不支持的图片格式：${ext}。仅支持 png / jpg / jpeg / webp / gif。`);
  }
  if (!isLikelyImage(buf)) {
    throw new Error(
      `文件 ${file.name} 不是合法的 png / jpg / webp / gif 图像（魔术字节不匹配），可能被恶意改名。`,
    );
  }
  const dir = getEcommerceUploadDir();
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const absolutePath = path.join(dir, filename);
  fs.writeFileSync(absolutePath, buf);
  return {
    absolutePath,
    relativePath: filename,
    size: buf.length,
    mimeType: file.type || guessMime(ext),
  };
}

function guessMime(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
}
