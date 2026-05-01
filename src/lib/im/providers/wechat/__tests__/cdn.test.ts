import crypto from 'node:crypto';
import {
  buildCdnDownloadUrl,
  decryptAesEcbPkcs7,
  detectImageMime,
  downloadAndDecryptCdnMedia,
  parseAesKey,
  parseAesKeyHex,
} from '../cdn';

function aesEncrypt(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

describe('wechat/cdn: parseAesKey', () => {
  test('decodes base64 of 16 raw bytes', () => {
    const raw = Buffer.from('0123456789abcdef', 'utf8');
    const b64 = raw.toString('base64');
    expect(parseAesKey(b64)).toEqual(raw);
  });

  test('decodes base64 of 32-char hex string', () => {
    const raw = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    const hex32 = raw.toString('hex'); // 32 chars
    const wrapped = Buffer.from(hex32, 'utf8').toString('base64');
    expect(parseAesKey(wrapped)).toEqual(raw);
  });

  test('rejects empty / wrong length', () => {
    expect(() => parseAesKey('')).toThrow(/empty/);
    const tooShort = Buffer.from('abc').toString('base64');
    expect(() => parseAesKey(tooShort)).toThrow(/16 raw bytes/);
  });
});

describe('wechat/cdn: parseAesKeyHex', () => {
  test('decodes 32-char hex', () => {
    const hex = '0123456789abcdef0123456789abcdef';
    expect(parseAesKeyHex(hex)).toEqual(Buffer.from(hex, 'hex'));
  });

  test('rejects non-hex / wrong length', () => {
    expect(() => parseAesKeyHex('not-hex-at-all-please-really-no')).toThrow();
    expect(() => parseAesKeyHex('0123')).toThrow();
  });
});

describe('wechat/cdn: AES-128-ECB / PKCS#7 round-trip', () => {
  test('round-trips arbitrary plaintext', () => {
    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    const plain = Buffer.from('hello, ilink CDN! mixed 字节 🌟', 'utf8');
    const cipher = aesEncrypt(plain, key);
    expect(decryptAesEcbPkcs7(cipher, key)).toEqual(plain);
  });

  test('rejects wrong key length', () => {
    const cipher = Buffer.alloc(16);
    expect(() => decryptAesEcbPkcs7(cipher, Buffer.alloc(8))).toThrow(/16 bytes/);
  });

  test('rejects unaligned ciphertext', () => {
    const key = Buffer.alloc(16);
    expect(() => decryptAesEcbPkcs7(Buffer.alloc(15), key)).toThrow(/aligned/);
  });
});

describe('wechat/cdn: buildCdnDownloadUrl', () => {
  test('escapes encrypted_query_param', () => {
    const url = buildCdnDownloadUrl('https://cdn.example/c2c/', 'abc?def&xyz');
    expect(url).toBe('https://cdn.example/c2c/download?encrypted_query_param=abc%3Fdef%26xyz');
  });

  test('strips trailing slash on base', () => {
    const url = buildCdnDownloadUrl('https://cdn.example/c2c////', 'p');
    expect(url).toBe('https://cdn.example/c2c/download?encrypted_query_param=p');
  });
});

describe('wechat/cdn: detectImageMime', () => {
  test.each([
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]), 'image/jpeg'],
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['gif87', Buffer.from('GIF87a some data', 'utf8'), 'image/gif'],
    ['gif89', Buffer.from('GIF89a some data', 'utf8'), 'image/gif'],
    [
      'webp',
      Buffer.concat([
        Buffer.from('RIFF', 'ascii'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP', 'ascii'),
      ]),
      'image/webp',
    ],
    ['unknown→jpeg fallback', Buffer.from([0x00, 0x00, 0x00]), 'image/jpeg'],
  ])('%s', (_label, bytes, expected) => {
    expect(detectImageMime(bytes)).toBe(expected);
  });
});

describe('wechat/cdn: downloadAndDecryptCdnMedia', () => {
  test('fetches CDN, decrypts, returns plaintext', async () => {
    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    const plain = Buffer.from('JFIF\xff\xd8\xff\x00 fake jpeg payload', 'binary');
    const cipher = aesEncrypt(plain, key);

    const fakeFetch = jest.fn(async () => ({
      ok: true,
      arrayBuffer: async () =>
        cipher.buffer.slice(cipher.byteOffset, cipher.byteOffset + cipher.byteLength),
    })) as unknown as typeof fetch;

    const out = await downloadAndDecryptCdnMedia({
      cdnBase: 'https://cdn.example/c2c',
      encryptedQueryParam: 'abc',
      aesKey: key,
      fetchImpl: fakeFetch,
    });
    expect(out).toEqual(plain);
    expect(fakeFetch).toHaveBeenCalledWith(
      'https://cdn.example/c2c/download?encrypted_query_param=abc',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('throws on non-200', async () => {
    const fakeFetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;

    await expect(
      downloadAndDecryptCdnMedia({
        cdnBase: 'https://cdn.example/c2c',
        encryptedQueryParam: 'x',
        aesKey: Buffer.alloc(16),
        fetchImpl: fakeFetch,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
