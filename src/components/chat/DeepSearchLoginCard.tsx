'use client';

import { useRouter } from 'next/navigation';
import { unwrapToolResult } from '@/lib/tool-result-parser';
import { AlertTriangle, LogIn, ExternalLink } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeepSearchLoginInfo {
  site: string;
  error: string;
  loginRequired: boolean;
  loginUrl: string;
}

interface DeepSearchLoginCardProps {
  info: DeepSearchLoginInfo;
}

// ---------------------------------------------------------------------------
// Site display names
// ---------------------------------------------------------------------------

const SITE_NAMES: Record<string, string> = {
  zhihu: '知乎',
  xiaohongshu: '小红书',
  juejin: '掘金',
  wechat: '微信公众号',
  x: 'X / Twitter',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeepSearchLoginCard({ info }: DeepSearchLoginCardProps) {
  const router = useRouter();
  const siteName = SITE_NAMES[info.site] || info.site;

  return (
    <div className="my-2 rounded-lg border border-amber-300/60 dark:border-amber-700/60 bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
      <div className="flex items-start gap-3 px-3 py-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground/80">
            {info.loginRequired
              ? `${siteName}账号数据获取失败，可能需要登录或刷新登录状态`
              : `${siteName}数据获取失败：${info.error}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-amber-200/60 dark:border-amber-800/40 px-3 py-2">
        <button
          type="button"
          onClick={() => router.push(info.loginUrl)}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 transition-colors"
        >
          <LogIn className="h-3.5 w-3.5" />
          前往登录{siteName ? ` ${siteName}` : ''}
        </button>
        <a
          href={info.loginUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          DeepSearch 设置
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parser: extract login/error info from DeepSearch tool results
// ---------------------------------------------------------------------------

export function extractDeepSearchError(
  pairedTools: Array<{ name: string; result?: string; isError?: boolean }>,
): DeepSearchLoginInfo | null {
  for (const tool of pairedTools) {
    if (!tool.name.includes('deepsearch') || !tool.result) continue;
    try {
      const data = unwrapToolResult(tool.result);
      if (!data || !data.error) continue;
      if (data.action !== 'fetch_account_data') continue;
      return {
        site: typeof data.site === 'string' ? data.site : '',
        error: typeof data.error === 'string' ? data.error : '未知错误',
        loginRequired: data.loginRequired === true,
        loginUrl: typeof data.loginUrl === 'string' ? data.loginUrl : '/extensions?tab=deepsearch',
      };
    } catch {
      continue;
    }
  }

  // Fallback: check error tool results for auth-related text
  for (const tool of pairedTools) {
    if (!tool.name.includes('deepsearch') || !tool.isError || !tool.result) continue;
    const authPattern = /未登录|登录已过期|请先登录|需要登录|expired|unauthorized/i;
    if (authPattern.test(tool.result)) {
      return {
        site: '',
        error: tool.result,
        loginRequired: true,
        loginUrl: '/extensions?tab=deepsearch',
      };
    }
  }

  return null;
}
