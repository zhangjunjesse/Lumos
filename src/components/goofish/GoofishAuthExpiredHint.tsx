'use client';

import { AlertTriangle } from 'lucide-react';

/**
 * 咸鱼登录已过期的统一展示组件。GoofishChatList / GoofishChatDetail 等组件
 * 在拿到 API 401 + GOOFISH_AUTH_EXPIRED 时挂这个提示，引导用户去顶部账号
 * 卡片点「重新登录」（不直接内嵌 LoginForm，避免和顶部出现两套登录入口）。
 */
export function GoofishAuthExpiredHint() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <div className="font-medium">咸鱼登录已过期</div>
        <div className="text-xs mt-0.5 opacity-80">
          请到上方账号卡片点「重新登录」重新扫码，再回来继续。
        </div>
      </div>
    </div>
  );
}
