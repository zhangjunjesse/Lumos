/**
 * PKCE(RFC 7636)与 state 生成。
 *
 * 桌面端只能做 public client —— 客户端密钥放在用户机器上等于没有,所以授权码
 * 必须靠 PKCE 绑定:发起时提交 challenge,兑换时出示 verifier,中途截获授权码
 * 的人没有 verifier 就换不到令牌。
 */

import { createHash, randomBytes } from 'crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  /** 固定 S256:plain 等于没保护,凡是支持 S256 的服务器都该用它。 */
  codeChallengeMethod: 'S256';
}

export function createPkcePair(): PkcePair {
  // 32 字节 → base64url 后 43 字符,正好落在 RFC 要求的 43–128 区间下限
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

/** 防 CSRF 的一次性 state,同时用作 pending 授权会话的键。 */
export function createState(): string {
  return base64url(randomBytes(24));
}
