/**
 * WeChat Work — WXBizMsgCrypt 实现
 *
 * 企业微信回调消息走 AES-256-CBC + PKCS7 + 自定义 padding 协议。
 * 算法规范：https://developer.work.weixin.qq.com/document/path/96211
 *
 * 流程：
 *   verifySignature(token, timestamp, nonce, encrypt) → 拒绝伪造请求
 *   decryptMessage(encodingAESKey, encrypt, expectedCorpId) → 明文 XML
 *
 * 不引入第三方包，纯 Node crypto。逻辑独立 + 单元可测。
 */

import crypto from 'node:crypto';

export class WXBizMsgCryptError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'WXBizMsgCryptError';
  }
}

/**
 * 校验 SHA1(sort([token, timestamp, nonce, encrypt])).hex === msg_signature
 */
export function verifySignature(args: {
  token: string;
  timestamp: string;
  nonce: string;
  encrypt: string;
  signature: string;
}): boolean {
  const sorted = [args.token, args.timestamp, args.nonce, args.encrypt].sort().join('');
  const sha1 = crypto.createHash('sha1').update(sorted).digest('hex');
  return timingSafeEqualHex(sha1, args.signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * 解密回调消息 Encrypt 字段。返回 { plaintext, receiveId }。
 *
 * encodingAESKey 是 43 字符 Base64 字符串，加上 '=' 填充后 Base64 解码得到 32 字节 AES 密钥。
 * IV 是 AES key 的前 16 字节。
 *
 * 解密后明文结构：
 *   [16B random] [4B BE msg_len] [<msg_len> bytes msg XML] [trailing receiveId UTF-8]
 *   还有 PKCS7 padding 在最后。
 */
export function decryptMessage(args: {
  encodingAesKey: string;
  encrypt: string;
  expectedCorpId: string;
}): { plaintext: string; receiveId: string } {
  const aesKey = decodeAesKey(args.encodingAesKey);
  const iv = aesKey.subarray(0, 16);

  const encrypted = Buffer.from(args.encrypt, 'base64');
  if (encrypted.length === 0 || encrypted.length % 16 !== 0) {
    throw new WXBizMsgCryptError('Invalid ciphertext length', 'INVALID_CIPHERTEXT');
  }

  let decrypted: Buffer;
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false); // PKCS7 stripping by hand for transparency
    decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (err) {
    throw new WXBizMsgCryptError(
      `AES decrypt failed: ${err instanceof Error ? err.message : 'unknown'}`,
      'DECRYPT_FAILED',
    );
  }

  decrypted = stripPkcs7(decrypted);
  if (decrypted.length < 20) {
    throw new WXBizMsgCryptError('Decrypted payload too short', 'PAYLOAD_TOO_SHORT');
  }

  const msgLen = decrypted.readUInt32BE(16);
  if (msgLen <= 0 || 20 + msgLen > decrypted.length) {
    throw new WXBizMsgCryptError(`Invalid msg length ${msgLen}`, 'INVALID_MSG_LEN');
  }

  const plaintext = decrypted.subarray(20, 20 + msgLen).toString('utf-8');
  const receiveId = decrypted.subarray(20 + msgLen).toString('utf-8');

  if (args.expectedCorpId && receiveId !== args.expectedCorpId) {
    throw new WXBizMsgCryptError(
      `corpId mismatch: got ${receiveId}, expected ${args.expectedCorpId}`,
      'CORP_ID_MISMATCH',
    );
  }

  return { plaintext, receiveId };
}

function decodeAesKey(encodingAesKey: string): Buffer {
  if (!encodingAesKey || encodingAesKey.length !== 43) {
    throw new WXBizMsgCryptError(
      `encodingAESKey must be 43 chars, got ${encodingAesKey?.length ?? 0}`,
      'INVALID_AES_KEY',
    );
  }
  const buf = Buffer.from(`${encodingAesKey}=`, 'base64');
  if (buf.length !== 32) {
    throw new WXBizMsgCryptError(
      `decoded AES key must be 32 bytes, got ${buf.length}`,
      'INVALID_AES_KEY',
    );
  }
  return buf;
}

function stripPkcs7(buf: Buffer): Buffer {
  if (buf.length === 0) return buf;
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) return buf; // out of range — assume no padding (lenient)
  return buf.subarray(0, buf.length - pad);
}

/**
 * 极简 XML 字段提取：仅支持 <Tag><![CDATA[...]]></Tag> 和 <Tag>value</Tag>。
 * 避免引入 xml2js 等大库；企业微信回调 XML 结构稳定且字段已知。
 */
export function extractXmlField(xml: string, field: string): string | null {
  const cdata = new RegExp(`<${field}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${field}>`).exec(xml);
  if (cdata) return cdata[1];
  const plain = new RegExp(`<${field}>([\\s\\S]*?)</${field}>`).exec(xml);
  if (plain) return plain[1];
  return null;
}
