const LONG_NUMERIC_ID = /\b\d{8,}\b/g;
const WECHAT_INTERNAL_ID = /\b(?:wxid_[A-Za-z0-9_-]+|[A-Za-z0-9_-]+@chatroom|\d{8,}@openim|gh_[A-Za-z0-9_-]+)\b/g;
const LEADING_INTERNAL_SPEAKER = /^\s*(?:wxid_[A-Za-z0-9_-]+|[A-Za-z0-9_-]+@chatroom|\d{8,}@openim|\d{8,}|gh_[A-Za-z0-9_-]+)\s*[:：]\s*/;

export function sanitizeWechatText(value: string): string {
  return value
    .replace(LEADING_INTERNAL_SPEAKER, '')
    .replace(WECHAT_INTERNAL_ID, '')
    .replace(LONG_NUMERIC_ID, '')
    .replace(/(^|[\s([{【-])[:：]\s*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([，。！？；：、])/g, '$1')
    .trim();
}

export function safeSanitizedWechatText(value: string | null | undefined, fallback: string): string {
  return sanitizeWechatText(value ?? '') || fallback;
}

export function displayWechatName(
  rawName: string | null | undefined,
  rawId: string | null | undefined,
  options: { groupFallback?: string; contactFallback?: string } = {},
): string {
  const cleaned = sanitizeWechatText(rawName ?? '');
  if (cleaned && !isLikelyInternalWechatId(cleaned)) return cleaned;
  return fallbackWechatName(rawId, options);
}

export function fallbackWechatName(
  rawId: string | null | undefined,
  options: { groupFallback?: string; contactFallback?: string } = {},
): string {
  return isLikelyGroupId(rawId)
    ? options.groupFallback ?? '微信群聊'
    : options.contactFallback ?? '微信联系人';
}

export function isLikelyGroupId(rawId: string | null | undefined): boolean {
  const value = rawId?.trim() ?? '';
  return value.endsWith('@chatroom') || /^\d{8,}$/.test(value);
}

function isLikelyInternalWechatId(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^wxid_[A-Za-z0-9_-]+$/.test(trimmed)
    || /^[A-Za-z0-9_-]+@chatroom$/.test(trimmed)
    || /^\d{8,}@openim$/.test(trimmed)
    || /^\d{8,}$/.test(trimmed)
    || /^gh_[A-Za-z0-9_-]+$/.test(trimmed)
  );
}
