'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, ExternalLink, Loader2, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useXAuth } from './use-x-auth';
import { XSearchSection } from './XSearchSection';
import { XCookiePasteForm } from './XCookiePasteForm';
import { XMentionsSettings } from './XMentionsSettings';

/**
 * X (Twitter) 服务面板。当前只有 read 路径(搜索 / 看用户推文 / 看 thread):
 *   1. 账号登录 — 优先粘贴 cookie(内置浏览器登录常被反爬挡);cookie 来自系统
 *      浏览器已登录的 x.com → DevTools → Application → Cookies。
 *   2. 搜索 — 调 /api/x/search。
 *
 * 写路径(发推 / 媒体上传)v1 不支持。社区 npm 包不维护或反爬不通,如需要发推
 * 用 X 官方 API v2 free tier 或直接到 x.com 网页。
 */
export function XPanel() {
  const { status, statusError, busy, actionMessage, refresh, login, logout } = useXAuth();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);

  const onSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/x/auth/sync-deepsearch', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setSyncResult({ kind: 'error', text: data?.message || `HTTP ${res.status}` });
        return;
      }
      const s = data.site || {};
      const ok = s.loginState === 'connected';
      setSyncResult({
        kind: ok ? 'ok' : 'error',
        text: ok
          ? `DeepSearch X 已同步: ${s.loginState}`
          : `DeepSearch X loginState=${s.loginState || '?'}, ${s.blockingReason || s.lastError || '未知原因'}`,
      });
    } catch (err) {
      setSyncResult({ kind: 'error', text: err instanceof Error ? err.message : '同步失败' });
    } finally {
      setSyncing(false);
    }
  };

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const loggedIn = status.loggedIn;

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="rounded-xl border border-border/60 bg-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-medium text-sm">X 账号</h3>
            <p className="text-xs text-muted-foreground">
              通过 Lumos 内置浏览器或粘贴 cookie 登录,cookie 仅保存在本机
            </p>
          </div>
          {loggedIn ? (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => void onSync()} disabled={syncing}>
                {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                同步到 DeepSearch
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void logout()} disabled={busy !== null}>
                {busy === 'logout' ? <Loader2 className="h-4 w-4" /> : <LogOut className="h-4 w-4 mr-1" />}
                退出
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => void login({ mode: 'browser', timeoutSecs: 300 })} disabled={busy !== null || !status.builtinBrowserReady}>
              {busy === 'login' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
              登录 X
            </Button>
          )}
        </div>

        {!loggedIn && (
          <div className="border-t border-border/40 pt-3 -mx-1">
            <button
              type="button"
              onClick={() => setPasteOpen((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${pasteOpen ? '' : '-rotate-90'}`} />
              内置浏览器登录不上?粘贴 cookie 登录
            </button>
            {pasteOpen && (
              <div className="mt-2 px-1">
                <XCookiePasteForm
                  busy={busy === 'login'}
                  onSubmit={(cookieString, meta) => login({
                    mode: 'paste',
                    cookieString,
                    screenName: meta.screenName,
                    name: meta.name,
                  })}
                />
              </div>
            )}
          </div>
        )}

        {loggedIn ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {status.name || status.screenName || `用户 #${status.userId}`}
              </div>
              <div className="text-xs text-muted-foreground">
                {status.screenName ? `@${status.screenName}` : ''} · #{status.userId}
              </div>
            </div>
          </div>
        ) : !status.builtinBrowserReady ? (
          <Alert>
            <AlertDescription className="text-xs">
              当前环境没有内置浏览器,无法走自动登录。请在桌面端 Lumos 中使用 X 模块,或粘贴 cookie。
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ExternalLink className="h-3 w-3" /> 点击「登录 X」会在内置浏览器打开 x.com 登录页,完成登录后自动检测 cookie
          </p>
        )}

        {actionMessage && (
          <Alert className={actionMessage.kind === 'error' ? 'border-red-500/50' : 'border-green-500/40'}>
            <AlertDescription className="text-xs">{actionMessage.text}</AlertDescription>
          </Alert>
        )}
        {syncResult && (
          <Alert className={syncResult.kind === 'error' ? 'border-red-500/50' : 'border-green-500/40'}>
            <AlertDescription className="text-xs">{syncResult.text}</AlertDescription>
          </Alert>
        )}
        {statusError && !actionMessage && (
          <p className="text-xs text-red-500">状态获取失败:{statusError}</p>
        )}
      </section>

      {loggedIn && (
        <XMentionsSettings initialScreenName={status.screenName} onSaved={() => void refresh()} />
      )}
      {loggedIn && <XSearchSection />}
    </div>
  );
}
