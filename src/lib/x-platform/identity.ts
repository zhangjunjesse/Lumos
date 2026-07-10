/**
 * 「当前登录用户是谁」——X 只在 cookie 里给数字 userId,不给用户名(handle),
 * 抓取库也没有「按 id 反查 handle」或「查我是谁」的接口,自己打 X GraphQL
 * 又过不了反爬。所以 handle 由用户在 UI 填一次,这里负责校验并存下:
 * 用抓取库把填的用户名反查成 id,和 cookie 里的登录 id 比对,一致才认。
 */

import {
  readCookies,
  hasRequiredCookies,
  userIdFromCookies,
  updateStoredMeta,
} from './cookies-store';
import { ensureScraper } from './scraper';
import { XAuthExpiredError, isXAuthExpiredError } from './auth-error';

export const X_SCREEN_NAME_INVALID = 'X_SCREEN_NAME_INVALID';
export const X_SCREEN_NAME_MISMATCH = 'X_SCREEN_NAME_MISMATCH';
export const X_SCREEN_NAME_UNSET = 'X_SCREEN_NAME_UNSET';

/** 用户名查不到 / 为空 —— 让路由回 400 并提示检查拼写。 */
export class XScreenNameInvalidError extends Error {
  readonly code = X_SCREEN_NAME_INVALID;
}

/** 用户名不是当前登录账号 —— 让路由回 400 并说明两个 id 对不上。 */
export class XScreenNameMismatchError extends Error {
  readonly code = X_SCREEN_NAME_MISMATCH;
}

/** 还没设置用户名 —— 让路由/工具提示「先去设置填一次」。 */
export class XScreenNameUnsetError extends Error {
  readonly code = X_SCREEN_NAME_UNSET;
}

/** 读已保存的用户名(handle),没有则空字符串。 */
export function getMyScreenName(): string {
  return readCookies()?.meta?.screenName || '';
}

/**
 * 校验并保存「我的用户名」。用抓取库把 handle 反查成数字 id,和当前登录
 * 账号的 id 比对:一致才存下,不一致或查不到就抛对应错误。
 */
export async function verifyAndSaveMyScreenName(
  handle: string,
): Promise<{ screenName: string; userId: string }> {
  const clean = (handle || '').trim().replace(/^@/, '');
  if (!clean) throw new XScreenNameInvalidError('用户名不能为空');

  const stored = readCookies();
  if (!stored || !hasRequiredCookies(stored.cookies)) {
    throw new XAuthExpiredError('X 未登录,请先登录再设置用户名');
  }
  const myUserId = userIdFromCookies(stored.cookies);

  const scraper = await ensureScraper();
  let resolvedId = '';
  try {
    resolvedId = await scraper.getUserIdByScreenName(clean);
  } catch (err) {
    if (isXAuthExpiredError(err)) throw new XAuthExpiredError('X 登录已过期,请重新登录');
    throw new XScreenNameInvalidError(`查不到用户名 @${clean},请检查拼写`);
  }

  if (myUserId && resolvedId && myUserId !== resolvedId) {
    throw new XScreenNameMismatchError(
      `@${clean} 不是当前登录账号(它的 ID 是 ${resolvedId},你登录的是 ${myUserId})`,
    );
  }

  updateStoredMeta({ screenName: clean });
  return { screenName: clean, userId: myUserId };
}
