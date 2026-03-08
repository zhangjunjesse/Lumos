import { loadToken } from '@/lib/feishu-auth';

export type FeishuAuthGuardResult =
  | { ok: true; openId: string; userName: string }
  | {
      ok: false;
      code: 'FEISHU_AUTH_REQUIRED' | 'FEISHU_AUTH_EXPIRED' | 'FEISHU_USER_INFO_MISSING';
      message: string;
    };

/**
 * Bridge workflow requires a valid Feishu OAuth user token,
 * so we can bind and verify sender identity.
 */
export function requireActiveFeishuUserAuth(): FeishuAuthGuardResult {
  const token = loadToken();
  if (!token) {
    return {
      ok: false,
      code: 'FEISHU_AUTH_REQUIRED',
      message: '请先在设置中登录飞书账号后再同步',
    };
  }

  if (Date.now() > token.expiresAt) {
    return {
      ok: false,
      code: 'FEISHU_AUTH_EXPIRED',
      message: '飞书登录已过期，请重新登录后再同步',
    };
  }

  const openId = token.userInfo?.open_id?.trim();
  if (!openId) {
    return {
      ok: false,
      code: 'FEISHU_USER_INFO_MISSING',
      message: '飞书账号信息不完整，请退出后重新登录',
    };
  }

  return {
    ok: true,
    openId,
    userName: token.userInfo?.name || '未知用户',
  };
}
