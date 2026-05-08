'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  busy: boolean;
  onSubmit: (cookieString: string) => Promise<boolean>;
}

/**
 * Cookie 粘贴登录入口。Lumos 内置浏览器在 X 登录流程上偶尔被反爬拦截
 * (Google SSO / 风控验证码),用户可以从已登录的 x.com DevTools 复制 cookie
 * 直接导入。优先级:builtin browser > paste。
 */
export function XCookiePasteForm({ busy, onSubmit }: Props) {
  const [cookie, setCookie] = useState('');

  const submit = async () => {
    const trimmed = cookie.trim();
    if (!trimmed || busy) return;
    const ok = await onSubmit(trimmed);
    if (ok) setCookie('');
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
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        在 x.com 已登录页面打开 DevTools → Application → Cookies → x.com,
        复制 <code className="font-mono">auth_token</code> /{' '}
        <code className="font-mono">ct0</code> /{' '}
        <code className="font-mono">twid</code> 三条(其它可选),
        粘贴成 <code className="font-mono">name=value; name=value</code> 格式。
      </p>
      <Button size="sm" onClick={() => void submit()} disabled={busy || !cookie.trim()}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        粘贴登录
      </Button>
    </div>
  );
}
