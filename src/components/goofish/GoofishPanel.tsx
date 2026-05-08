'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, Download, ExternalLink, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useGoofishAuth } from './use-goofish-auth';
import { GoofishChatList } from './GoofishChatList';
import { GoofishChatDetail } from './GoofishChatDetail';
import { GoofishLoginForm } from './GoofishLoginForm';


/**
 * 闲鱼能力面板。两种登录路径：
 *   1. 系统浏览器自动导入（goofish-cli 调 browser_cookie3）
 *   2. 粘贴 Cookie 头字符串（兜底）
 *
 * 默认渲染最简：未登录显示一组登录按钮；已登录显示账号 + 退出。
 * 写操作（item publish / delete / media upload）的开关 v1 不在这里暴露，
 * 留给后续版本，避免用户在未充分验证前误触发 mtop 风控。
 */
export function GoofishPanel() {
  const { status, statusError, busy, actionMessage, refresh, login, logout, install } = useGoofishAuth();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [cookieInput, setCookieInput] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);
  // Which account's chats to show in the list. 'all' merges every account.
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [selectedSession, setSelectedSession] = useState<{
    session_id: string;
    peer_nick: string;
    peer_user_id: string;
    peer_avatar: string;
    unread: number;
    account_unb: string;
  } | null>(null);

  const accounts = status?.accounts ?? [];
  const validAccounts = accounts.filter((a) => a.valid);
  // "Have any account" = the directory exists with cookies, even if the
  // token is currently expired (will be auto-refreshed in headless mode
  // on next mtop call). Hiding expired accounts confuses users who just
  // logged in moments ago.
  const hasAnyAccount = accounts.length > 0;

  // Switch account: drop selected session in same handler (avoids
  // setState-in-effect). 'all' is also a valid target.
  const selectAccount = (unb: string) => {
    setSelectedAccount(unb);
    setSelectedSession(null);
  };
  // Wrap login so a successful return closes the "add account" overlay.
  // QR mode now prefers Lumos's built-in browser. The legacy Playwright
  // download only gates environments where the browser bridge is unavailable.
  const submitLogin = async (input: Parameters<typeof login>[0]) => {
    if (input.mode === 'qr' && status && (status.qrLoginMode === 'needs-install' || !status.qrReady)) {
      const proceed = window.confirm(
        '当前没有检测到 Lumos 内置浏览器，需要下载备用扫码浏览器组件（约 150MB），是否继续？\n\n' +
        '桌面端正常情况下会直接使用 Lumos 自带浏览器，不需要下载这个组件。',
      );
      if (!proceed) return;
      const ok = await install('qr');
      if (!ok) return;
    }
    void login(input).then(() => setAddingAccount(false));
  };
  // If the selected account vanished from the list (logout / sync), fall
  // back to 'all' on render — purely derived, no setState.
  const effectiveAccount = selectedAccount !== 'all'
    && !validAccounts.some((a) => a.accountUnb === selectedAccount)
    ? 'all' : selectedAccount;

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status.installed) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Alert>
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium">需要先安装 goofish-cli</p>
              <p className="text-sm text-muted-foreground">
                Lumos 通过开源项目{' '}
                <a
                  href="https://github.com/fancyboi999/goofish-cli"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-4 inline-flex items-center gap-1"
                >
                  fancyboi999/goofish-cli
                  <ExternalLink className="h-3 w-3" />
                </a>
                {' '}（Apache-2.0）调用闲鱼。约 20MB，会装到 Lumos 内置 Python 环境，不污染系统 Python。
              </p>
            </div>
          </AlertDescription>
        </Alert>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void install('core')} disabled={busy !== null}>
            {busy === 'install'
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <Download className="h-4 w-4 mr-2" />}
            {busy === 'install' ? '安装中…' : '一键安装'}
          </Button>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={busy !== null}>
            <RefreshCw className="h-4 w-4 mr-1" /> 重新检测
          </Button>
        </div>
        {actionMessage && (
          <Alert className={actionMessage.kind === 'error' ? 'border-red-500/50' : 'border-green-500/40'}>
            <AlertDescription>{actionMessage.text}</AlertDescription>
          </Alert>
        )}
        <details>
          <summary className="text-xs text-muted-foreground cursor-pointer select-none">
            想自己装？
          </summary>
          <pre className="text-xs bg-muted/40 px-3 py-2 rounded font-mono mt-2">
            pip install --user goofish-cli
          </pre>
          <p className="text-xs text-muted-foreground mt-1">
            装到系统/用户 Python 后，点上方「重新检测」。
          </p>
        </details>
        {statusError && (
          <p className="text-xs text-red-500">状态获取失败：{statusError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* 账号管理卡片 */}
      <section className="rounded-xl border border-border/60 bg-card p-5">
        {hasAnyAccount && !addingAccount ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-medium text-sm">已登录账号 ({accounts.length})</h3>
                <p className="text-xs text-muted-foreground">所有账号同时在线，可分别查看或合并</p>
              </div>
              <Button
                size="sm"
                onClick={() => setAddingAccount(true)}
                disabled={busy !== null}
              >
                + 添加账号
              </Button>
            </div>
            <ul className="divide-y divide-border/60">
              {accounts.map((acc) => (
                <li key={acc.accountUnb} className="flex items-center gap-3 py-2">
                  {acc.valid
                    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    : <span className="h-4 w-4 rounded-full bg-red-500 shrink-0" title="登录已过期，请重新扫码登录" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {acc.nick || acc.tracknick || `账号 #${acc.accountUnb}`}
                      {!acc.valid && <span className="text-xs text-red-600 ml-2">登录已过期</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">#{acc.accountUnb}</div>
                  </div>
                  {!acc.valid && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        await logout(acc.accountUnb);
                        setAddingAccount(true);
                      }}
                      disabled={busy !== null}
                      title="退出并立即重新扫码登录"
                    >
                      重新登录
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void logout(acc.accountUnb)}
                    disabled={busy !== null}
                    title="退出账号"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <GoofishLoginForm
            hasOtherAccounts={hasAnyAccount}
            busy={busy}
            onCancel={hasAnyAccount ? () => setAddingAccount(false) : undefined}
            onLogin={submitLogin}
          />
        )}

        {actionMessage && (
          <Alert
            className={`mt-4 ${actionMessage.kind === 'error' ? 'border-red-500/50' : 'border-green-500/40'}`}
          >
            <AlertDescription>{actionMessage.text}</AlertDescription>
          </Alert>
        )}
        {statusError && !actionMessage && (
          <p className="text-xs text-red-500 mt-3">状态获取失败：{statusError}</p>
        )}
      </section>

      {hasAnyAccount && !addingAccount && (
        <>
          {/* 账号选择器：当有多个账号时让用户切换（只看一个 / 看全部） */}
          {validAccounts.length > 1 && !selectedSession && (
            <div className="flex flex-wrap items-center gap-2 px-1">
              <span className="text-xs text-muted-foreground">查看：</span>
              <button
                onClick={() => selectAccount('all')}
                className={`text-xs px-2 py-1 rounded-md border ${effectiveAccount === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border/60 hover:bg-muted/40'}`}
              >
                全部账号
              </button>
              {validAccounts.map((acc) => (
                <button
                  key={acc.accountUnb}
                  onClick={() => selectAccount(acc.accountUnb)}
                  className={`text-xs px-2 py-1 rounded-md border ${effectiveAccount === acc.accountUnb ? 'bg-primary text-primary-foreground border-primary' : 'border-border/60 hover:bg-muted/40'}`}
                >
                  {acc.nick || acc.tracknick || `#${acc.unb}`}
                </button>
              ))}
            </div>
          )}

          {selectedSession
            ? <GoofishChatDetail
                key={selectedSession.session_id}
                session={selectedSession}
                // session.account_unb 是该会话归属的账号,'all' 视图下选第二个账号
                // 的 session 时,这里能正确锁定到第二个账号的 unb,避免气泡方向错。
                myUserId={validAccounts.find(a => a.accountUnb === selectedSession.account_unb)?.unb || ''}
                onBack={() => setSelectedSession(null)}
              />
            : <GoofishChatList key={effectiveAccount} account={effectiveAccount} onSelect={(s) => setSelectedSession({
                session_id: s.session_id,
                peer_nick: s.peer_nick,
                peer_user_id: s.peer_user_id,
                peer_avatar: s.peer_avatar,
                unread: s.unread,
                account_unb: s.account_unb,
              })} />}
        </>
      )}

      {/* 高级：粘贴 cookie */}
      <section className="rounded-xl border border-border/40 bg-muted/10 p-4">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? '' : '-rotate-90'}`} />
          高级：粘贴 cookie 字符串导入
        </button>
        {advancedOpen && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              已经在外部登录过的话，可以从浏览器 DevTools 复制完整的 Cookie 头粘到这里。
              格式形如 <code className="bg-muted/40 px-1 rounded">cookie2=...; unb=...; _m_h5_tk=...</code>
            </p>
            <textarea
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              rows={5}
              className="w-full text-xs font-mono bg-background border rounded px-2 py-1.5"
              placeholder="cookie2=...; unb=...; _m_h5_tk=...; ..."
              disabled={busy !== null}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void login({ mode: 'paste', cookieString: cookieInput })}
              disabled={busy !== null || !cookieInput.trim()}
            >
              {busy === 'login' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              导入 cookie
            </Button>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        v1 暴露：商品搜索 / 消息收发 / 商品详情 / AI 类目识别。<br />
        v1 不暴露：商品发布 / 下架 / 图片上传（写操作未充分验证，避免触发风控）。
      </p>
    </div>
  );
}
