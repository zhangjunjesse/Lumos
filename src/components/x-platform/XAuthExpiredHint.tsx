'use client';

import { AlertTriangle } from 'lucide-react';

/**
 * X 登录已过期统一展示。镜像 GoofishAuthExpiredHint, 引导用户去顶部账号
 * 卡片重新登录而不是嵌入 LoginForm。
 */
export function XAuthExpiredHint() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <div className="font-medium">X 登录已过期</div>
        <div className="text-xs mt-0.5 opacity-80">
          请到上方账号卡片点「重新登录」,登录完成后再试。
        </div>
      </div>
    </div>
  );
}
