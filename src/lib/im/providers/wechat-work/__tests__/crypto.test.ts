import crypto from 'node:crypto';
import {
  verifySignature,
  decryptMessage,
  extractXmlField,
  WXBizMsgCryptError,
} from '../crypto';

const TOKEN = 'TestToken123';
const ENCODING_AES_KEY = 'A'.repeat(43); // 43-char base64 → 32-byte key after '=' padding
const CORP_ID = 'wwSampleCorpID';

/**
 * Test helper: encrypt plaintext using the same algorithm so we can round-trip test decryptMessage.
 */
function encryptPlaintext(plaintext: string, opts: {
  encodingAesKey: string;
  corpId: string;
  random?: Buffer;
}): string {
  const aesKey = Buffer.from(`${opts.encodingAesKey}=`, 'base64');
  const iv = aesKey.subarray(0, 16);
  const random = opts.random ?? crypto.randomBytes(16);
  const msgBuf = Buffer.from(plaintext, 'utf-8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);
  const corpBuf = Buffer.from(opts.corpId, 'utf-8');

  const body = Buffer.concat([random, lenBuf, msgBuf, corpBuf]);
  const padLen = 32 - (body.length % 32);
  const padded = Buffer.concat([body, Buffer.alloc(padLen, padLen)]);

  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

function buildSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  const sorted = [token, timestamp, nonce, encrypt].sort().join('');
  return crypto.createHash('sha1').update(sorted).digest('hex');
}

describe('wechat-work/crypto: verifySignature', () => {
  test('accepts valid signature', () => {
    const sig = buildSignature(TOKEN, '1700000000', 'nonce123', 'cipher_text');
    expect(verifySignature({
      token: TOKEN,
      timestamp: '1700000000',
      nonce: 'nonce123',
      encrypt: 'cipher_text',
      signature: sig,
    })).toBe(true);
  });

  test('rejects wrong signature', () => {
    expect(verifySignature({
      token: TOKEN,
      timestamp: '1700000000',
      nonce: 'nonce123',
      encrypt: 'cipher_text',
      signature: '0'.repeat(40),
    })).toBe(false);
  });

  test('rejects different token', () => {
    const sig = buildSignature('WRONG_TOKEN', '1700000000', 'n', 'c');
    expect(verifySignature({
      token: TOKEN,
      timestamp: '1700000000',
      nonce: 'n',
      encrypt: 'c',
      signature: sig,
    })).toBe(false);
  });
});

describe('wechat-work/crypto: decryptMessage', () => {
  test('round-trips plaintext', () => {
    const plaintext = '<xml><MsgType>text</MsgType><Content>hi</Content></xml>';
    const encrypt = encryptPlaintext(plaintext, {
      encodingAesKey: ENCODING_AES_KEY,
      corpId: CORP_ID,
    });
    const result = decryptMessage({
      encodingAesKey: ENCODING_AES_KEY,
      encrypt,
      expectedCorpId: CORP_ID,
    });
    expect(result.plaintext).toBe(plaintext);
    expect(result.receiveId).toBe(CORP_ID);
  });

  test('rejects mismatched corpId', () => {
    const encrypt = encryptPlaintext('payload', {
      encodingAesKey: ENCODING_AES_KEY,
      corpId: 'wwOther',
    });
    expect(() =>
      decryptMessage({
        encodingAesKey: ENCODING_AES_KEY,
        encrypt,
        expectedCorpId: CORP_ID,
      }),
    ).toThrow(WXBizMsgCryptError);
  });

  test('rejects 42-char encodingAESKey', () => {
    expect(() =>
      decryptMessage({
        encodingAesKey: 'A'.repeat(42),
        encrypt: 'whatever',
        expectedCorpId: CORP_ID,
      }),
    ).toThrow(/43 chars/);
  });

  test('rejects garbage ciphertext', () => {
    expect(() =>
      decryptMessage({
        encodingAesKey: ENCODING_AES_KEY,
        encrypt: 'not-base64!!',
        expectedCorpId: CORP_ID,
      }),
    ).toThrow(WXBizMsgCryptError);
  });
});

describe('wechat-work/crypto: extractXmlField', () => {
  test('extracts CDATA value', () => {
    const xml = '<xml><Content><![CDATA[hello world]]></Content></xml>';
    expect(extractXmlField(xml, 'Content')).toBe('hello world');
  });

  test('extracts plain value', () => {
    const xml = '<xml><CreateTime>1700000000</CreateTime></xml>';
    expect(extractXmlField(xml, 'CreateTime')).toBe('1700000000');
  });

  test('returns null when missing', () => {
    expect(extractXmlField('<xml/>', 'NotThere')).toBeNull();
  });

  test('handles multi-line CDATA', () => {
    const xml = '<xml><Content><![CDATA[line1\nline2]]></Content></xml>';
    expect(extractXmlField(xml, 'Content')).toBe('line1\nline2');
  });
});
