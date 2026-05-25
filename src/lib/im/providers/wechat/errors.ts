const SESSION_EXPIRED_PATTERN = /(?:session\s*timeout|errcode\s*=?\s*-?14)/i;

export function explainWechatIlinkError(error: string | undefined | null): string {
  const raw = String(error || '').trim();
  if (!raw) return '微信 iLink 请求失败，但没有返回具体错误。';
  if (!SESSION_EXPIRED_PATTERN.test(raw)) return raw;
  return [
    '微信登录状态已过期或会话失效，请到「设置 > IM > 微信」重新扫码绑定后再发送。',
    `原始错误：${raw}`,
  ].join(' ');
}
