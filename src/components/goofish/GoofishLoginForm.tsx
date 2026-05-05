'use client';

import { useState } from 'react';
import { ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LoginMode } from './use-goofish-auth';

const GOOFISH_HOMEPAGE = 'https://www.goofish.com';

interface Props {
  hasOtherAccounts: boolean;
  busy: null | 'login' | 'logout';
  onCancel?: () => void;
  onLogin: (input: LoginMode) => void;
}

/**
 * Login form — extracted from GoofishPanel to keep that file under the
 * 300-line cap. Renders QR (recommended) + browser auto-import (fallback).
 */
export function GoofishLoginForm({ hasOtherAccounts, busy, onCancel, onLogin }: Props) {
  const [browserChoice, setBrowserChoice] = useState('auto');

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium mb-1">{hasOtherAccounts ? '添加新账号' : '未登录闲鱼'}</h3>
          <p className="text-sm text-muted-foreground">
            {hasOtherAccounts
              ? '可以同时登多个号，AI 能跨账号管理。'
              : '登录后 AI 可以帮你搜索商品、收发消息。'}
          </p>
        </div>
        {hasOtherAccounts && onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy !== null}>
            取消
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <Button size="sm" onClick={() => onLogin({ mode: 'qr' })} disabled={busy !== null}>
            {busy === 'login' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            扫码登录（推荐）
          </Button>
          <p className="text-xs text-muted-foreground mt-1">
            会弹一个 Chrome 窗口，最长等 5 分钟。期间你可以扫码、输密码、切账号都行 —
            我们就盯着 cookie，登成什么样不重要。
          </p>
        </div>

        <details className="group">
          <summary className="text-sm text-muted-foreground hover:text-foreground cursor-pointer select-none flex items-center gap-2">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-0 -rotate-90" />
            其他登录方式
          </summary>
          <div className="mt-3 space-y-2 pl-6">
            <p className="text-xs text-muted-foreground">
              <strong>从系统浏览器导入</strong>：要求你已经在系统浏览器（{' '}
              <a
                href={GOOFISH_HOMEPAGE}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-4 inline-flex items-center gap-1"
              >
                goofish.com
                <ExternalLink className="h-3 w-3" />
              </a>
              ）登录过，否则会失败。
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                className="text-sm border rounded px-2 py-1.5 bg-background"
                value={browserChoice}
                onChange={(e) => setBrowserChoice(e.target.value)}
                disabled={busy !== null}
              >
                <option value="auto">自动检测浏览器</option>
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="brave">Brave</option>
                <option value="safari">Safari</option>
                <option value="firefox">Firefox</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onLogin({ mode: 'browser', browser: browserChoice })}
                disabled={busy !== null}
              >
                导入登录态
              </Button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
