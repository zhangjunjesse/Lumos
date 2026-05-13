'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  busy: boolean;
  onSubmit: (cookieString: string, meta: { screenName?: string; name?: string }) => Promise<boolean>;
}

/**
 * Cookie 粘贴登录入口。Lumos 内置浏览器在 X 登录流程上常被反爬拦截,用户可
 * 从已登录的 x.com DevTools 复制 cookie 直接导入。
 *
 * @username / 显示名是可选输入:@the-convocation/twitter-scraper 没暴露"按
 * user_id 反查 screen_name"的接口,只能让用户在登录时一并填写,后续 UI 直接
 * 显示。不填则 fallback 到 "用户 #userId"。
 */
export function XCookiePasteForm({ busy, onSubmit }: Props) {
  const [cookie, setCookie] = useState('');
  const [screenName, setScreenName] = useState('');
  const [name, setName] = useState('');

  const submit = async () => {
    const trimmed = cookie.trim();
    if (!trimmed || busy) return;
    const ok = await onSubmit(trimmed, {
      screenName: screenName.trim() || undefined,
      name: name.trim() || undefined,
    });
    if (ok) {
      setCookie('');
      setScreenName('');
      setName('');
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
        placeholder="auth_token=...; ct0=...; twid=u%3D123456; ..."
        rows={4}
        disabled={busy}
        className="w-full text-xs font-mono bg-muted/30 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={screenName}
          onChange={(e) => setScreenName(e.target.value)}
          placeholder="@用户名 (可选)"
          disabled={busy}
          className="text-xs bg-muted/30 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="显示名 (可选)"
          disabled={busy}
          className="text-xs bg-muted/30 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        在 x.com 已登录页面 DevTools → Application → Cookies → x.com,复制{' '}
        <code className="font-mono">auth_token</code> /{' '}
        <code className="font-mono">ct0</code> /{' '}
        <code className="font-mono">twid</code> 三条(其它可选),粘贴成{' '}
        <code className="font-mono">name=value; name=value</code> 格式。
        @用户名 / 显示名是可选,只用于 UI 展示。
      </p>
      <Button size="sm" onClick={() => void submit()} disabled={busy || !cookie.trim()}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        粘贴登录
      </Button>
    </div>
  );
}
