/**
 * 「谁 @ 我」—— 本质是搜提到我用户名的推文。X 没有给第三方的通知/提及
 * 时间线接口,这里用已存的用户名拼 `@handle` 走标准搜索(Latest 时间倒序),
 * 覆盖通知栏「提及」那一类的公开可见部分。点赞/转发/关注等通知覆盖不到。
 */

import { searchTweets } from './search';
import { getMyScreenName, XScreenNameUnsetError } from './identity';
import type { XSearchResult } from './types';

export interface XMentionsResult extends XSearchResult {
  /** 当前用来搜索的用户名(handle)。 */
  screenName: string;
}

/**
 * 搜最近 @ 我的推文。未设置用户名时抛 XScreenNameUnsetError,
 * 让上层提示用户先去「服务 → X」填一次。
 */
export async function searchMyMentions(
  opts: { count?: number; timeoutMs?: number; allowPartialOnTimeout?: boolean } = {},
): Promise<XMentionsResult> {
  const screenName = getMyScreenName();
  if (!screenName) {
    throw new XScreenNameUnsetError('还没设置你的 X 用户名,请先在「服务 → X」面板填一次');
  }
  const result = await searchTweets(`@${screenName}`, {
    count: opts.count,
    mode: 'Latest',
    timeoutMs: opts.timeoutMs,
    allowPartialOnTimeout: opts.allowPartialOnTimeout,
  });
  return { ...result, screenName };
}
