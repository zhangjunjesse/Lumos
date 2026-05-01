/**
 * WeChat ilink CDN — download + AES-128-ECB / PKCS#7 helpers.
 *
 * 复刻自 cc-connect/platform/weixin/cdn.go (MIT)。
 * 入站图片/语音/文件的 bytes 来自加密 CDN，下载后用 imageItem.aeskey (hex)
 * 或 media.aes_key (base64) 作为 16-byte AES key 解密。
 */

import crypto from 'node:crypto';

export const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // 100 MiB

const HEX32_RE = /^[0-9a-fA-F]{32}$/;

/**
 * Decode CDN media aes_key into 16 raw bytes.
 *
 * Accepts (matching cc-connect parseAesKey):
 *   - base64(raw 16 bytes)         → returned directly
 *   - base64("32-char hex string") → hex-decoded to 16 bytes
 */
export function parseAesKey(aesKeyBase64: string): Buffer {
  const trimmed = aesKeyBase64.trim();
  if (!trimmed) throw new Error('aes_key empty');

  let decoded: Buffer;
  try {
    decoded = Buffer.from(trimmed, 'base64');
  } catch (err) {
    throw new Error(`aes_key base64 decode failed: ${err instanceof Error ? err.message : err}`);
  }

  if (decoded.length === 16) return decoded;
  if (decoded.length === 32) {
    const s = decoded.toString('utf8');
    if (HEX32_RE.test(s)) {
      return Buffer.from(s, 'hex');
    }
  }
  throw new Error(`aes_key must be 16 raw bytes or 32-char hex (base64-wrapped), got ${decoded.length} bytes`);
}

/** Hex-encoded 32 chars → 16 raw bytes. Used by imageItem.aeskey path. */
export function parseAesKeyHex(hex: string): Buffer {
  const s = hex.trim();
  if (!HEX32_RE.test(s)) {
    throw new Error(`expected 32-char hex aes key, got "${s.slice(0, 16)}…"`);
  }
  return Buffer.from(s, 'hex');
}

/** AES-128-ECB + PKCS#7 padding decrypt. Throws on bad padding or wrong key. */
export function decryptAesEcbPkcs7(ciphertext: Buffer, key: Buffer): Buffer {
  if (key.length !== 16) {
    throw new Error(`aes key must be 16 bytes, got ${key.length}`);
  }
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error(`ciphertext length ${ciphertext.length} not aligned to 16-byte block`);
  }
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted;
}

/** Build the CDN GET-download URL. */
export function buildCdnDownloadUrl(cdnBase: string, encryptedQueryParam: string): string {
  const base = cdnBase.replace(/\/+$/, '');
  return `${base}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

/** Detect image MIME type from magic bytes. Falls back to image/jpeg. */
export function detectImageMime(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 6) {
    const head = bytes.slice(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12
    && bytes.slice(0, 4).toString('ascii') === 'RIFF'
    && bytes.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

/**
 * Fetch encrypted bytes from the CDN and AES-128-ECB decrypt them.
 * Returns the plaintext image / file bytes.
 */
export async function downloadAndDecryptCdnMedia(args: {
  cdnBase: string;
  encryptedQueryParam: string;
  aesKey: Buffer;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const { cdnBase, encryptedQueryParam, aesKey, signal } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const url = buildCdnDownloadUrl(cdnBase, encryptedQueryParam);
  const res = await fetchImpl(url, { method: 'GET', signal });
  if (!res.ok) {
    throw new Error(`CDN download HTTP ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
    throw new Error(`CDN body exceeds ${MAX_MEDIA_BYTES} bytes`);
  }
  const enc = Buffer.from(arrayBuffer);
  return decryptAesEcbPkcs7(enc, aesKey);
}
