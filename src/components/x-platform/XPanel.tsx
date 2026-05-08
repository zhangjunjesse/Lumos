'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, ExternalLink, Loader2, LogIn, LogOut } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useXAuth } from './use-x-auth';
import { XSearchSection } from './XSearchSection';
import { XComposeSection } from './XComposeSection';
import { XCookiePasteForm } from './XCookiePasteForm';

/**
 * X (Twitter) 服务面板。两类操作：
 *   1. 账号登录/退出 (Lumos 内置浏览器跳 x.com,后端轮询 cookies)
 *   2. 搜索 / 发推 / 读时间线 (登录后启用)
 *
 * 单账号设计 — 多账号 anti-fraud 风险高,留 v2。
 */
export function XPanel() {
  const { status, statusError, busy, actionMessage, login, logout } = useXAuth();
  const [tab, setTab] = useState<'search' | 'compose'>('search');
  const [pasteOpen, setPasteOpen] = useState(false);

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
      {/* 账号卡片 */}
      <section className="rounded-xl border border-border/60 bg-card p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-medium text-sm">X 账号</h3>
            <p className="text-xs text-muted-foreground">
              通过 Lumos 内置浏览器登录,cookie 仅保存在本机
            </p>
          </div>
          {loggedIn ? (
            <Button variant="ghost" size="sm" onClick={() => void logout()} disabled={busy !== null}>
              {busy === 'logout' ? <Loader2 className="h-4 w-4" /> : <LogOut className="h-4 w-4 mr-1" />}
              退出
            </Button>
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
                  onSubmit={(cookieString) => login({ mode: 'paste', cookieString })}
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
              当前环境没有内置浏览器,无法走自动登录。请在桌面端 Lumos 中使用 X 模块。
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ExternalLink className="h-3 w-3" /> 点击「登录 X」会在内置浏览器打开 x.com 登录页,完成登录后会自动检测 cookie
          </p>
        )}

        {actionMessage && (
          <Alert className={actionMessage.kind === 'error' ? 'border-red-500/50' : 'border-green-500/40'}>
            <AlertDescription className="text-xs">{actionMessage.text}</AlertDescription>
          </Alert>
        )}
        {statusError && !actionMessage && (
          <p className="text-xs text-red-500">状态获取失败：{statusError}</p>
        )}
      </section>

      {loggedIn && (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab('search')}
              className={`text-xs px-3 py-1.5 rounded-md border ${tab === 'search' ? 'bg-primary text-primary-foreground border-primary' : 'border-border/60 hover:bg-muted/40'}`}
            >
              搜索
            </button>
            <button
              type="button"
              onClick={() => setTab('compose')}
              className={`text-xs px-3 py-1.5 rounded-md border ${tab === 'compose' ? 'bg-primary text-primary-foreground border-primary' : 'border-border/60 hover:bg-muted/40'}`}
            >
              发推
            </button>
          </div>
          {tab === 'search' ? <XSearchSection /> : <XComposeSection />}
        </>
      )}
    </div>
  );
}
