import crypto from 'node:crypto';
import {
  aesEcbPaddedSize,
  buildCdnDownloadUrl,
  buildCdnUploadUrl,
  decryptAesEcbPkcs7,
  detectImageMime,
  downloadAndDecryptCdnMedia,
  encryptAesEcbPkcs7,
  formatAesKeyForApi,
  md5Hex,
  parseAesKey,
  parseAesKeyHex,
  uploadEncryptedToCdn,
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

describe('wechat/cdn: aesEcbPaddedSize / md5Hex / formatAesKeyForApi', () => {
  test('aesEcbPaddedSize matches PKCS#7 ciphertext length', () => {
    expect(aesEcbPaddedSize(0)).toBe(16);   // empty → one full block of padding
    expect(aesEcbPaddedSize(1)).toBe(16);
    expect(aesEcbPaddedSize(15)).toBe(16);
    expect(aesEcbPaddedSize(16)).toBe(32);  // exact multiple → extra full block
    expect(aesEcbPaddedSize(17)).toBe(32);
  });

  test('md5Hex is lowercase hex of standard MD5', () => {
    expect(md5Hex(Buffer.from('hello', 'utf8'))).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  test('formatAesKeyForApi is base64(hex(rawKey))', () => {
    const key = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    const formatted = formatAesKeyForApi(key);
    // decode and check it's hex of the original
    const decoded = Buffer.from(formatted, 'base64').toString('utf8');
    expect(decoded).toBe('0123456789abcdef0123456789abcdef');
  });
});

describe('wechat/cdn: buildCdnUploadUrl', () => {
  test('formats upload URL with upload_param + filekey', () => {
    expect(buildCdnUploadUrl('https://cdn.example/c2c', 'p&q', 'key#1')).toBe(
      'https://cdn.example/c2c/upload?encrypted_query_param=p%26q&filekey=key%231',
    );
  });
});

describe('wechat/cdn: encryptAesEcbPkcs7 round-trip', () => {
  test('round-trips arbitrary plaintext', () => {
    const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const plain = Buffer.from('图片字节 binary data 🌟', 'utf8');
    const cipher = encryptAesEcbPkcs7(plain, key);
    expect(cipher.length).toBe(aesEcbPaddedSize(plain.length));
    expect(decryptAesEcbPkcs7(cipher, key)).toEqual(plain);
  });
});

describe('wechat/cdn: uploadEncryptedToCdn', () => {
  test('POSTs ciphertext, returns x-encrypted-param header', async () => {
    const fakeFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k === 'x-encrypted-param' ? 'DL-PARAM' : null) },
    })) as unknown as typeof fetch;

    const dl = await uploadEncryptedToCdn({
      uploadUrl: 'https://cdn.example/c2c/upload?xx',
      plaintext: Buffer.from('hello'),
      aesKey: Buffer.alloc(16, 7),
      fetchImpl: fakeFetch,
    });
    expect(dl).toBe('DL-PARAM');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const call = (fakeFetch as unknown as jest.Mock).mock.calls[0];
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Content-Type']).toBe('application/octet-stream');
  });

  test('throws on 4xx (no retry)', async () => {
    const fakeFetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      headers: { get: () => 'bad request' },
    })) as unknown as typeof fetch;

    await expect(uploadEncryptedToCdn({
      uploadUrl: 'https://cdn.example/c2c/upload?xx',
      plaintext: Buffer.from('hello'),
      aesKey: Buffer.alloc(16),
      fetchImpl: fakeFetch,
    })).rejects.toThrow(/client error 400/);
  });

  test('retries on 5xx and eventually fails after 3 attempts', async () => {
    const fakeFetch = jest.fn(async () => ({
      ok: false,
      status: 502,
      headers: { get: () => null },
    })) as unknown as typeof fetch;

    await expect(uploadEncryptedToCdn({
      uploadUrl: 'https://cdn.example/c2c/upload?xx',
      plaintext: Buffer.from('hello'),
      aesKey: Buffer.alloc(16),
      fetchImpl: fakeFetch,
    })).rejects.toThrow(/server error: status 502/);
    expect((fakeFetch as unknown as jest.Mock).mock.calls.length).toBe(3);
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
