'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowUpRight, MessageCircleHeart } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { StatusDot } from './AppCard';

interface BuiltinWeChatStatus {
  app?: { id: string; name: string; version: string; source: string; status: string };
  export?: { ready: boolean; phase: string; supported: boolean; keyCount?: number };
  im?: { enabled: boolean; configured: boolean; isDefault: boolean };
}

export function BuiltinWeChatCard({
  status,
}: {
  status: BuiltinWeChatStatus | null;
}): React.ReactElement {
  const ready = !!status?.export?.ready;
  const phase = status?.export?.phase;
  return (
    <Link
      href="/apps/wechat-assistant"
      className="group block rounded-2xl bg-card p-6 ring-1 ring-border transition-colors hover:ring-foreground/30"
    >
      <div className="flex items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm">
          <MessageCircleHeart className="size-6" strokeWidth={1.75} />
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold leading-tight tracking-tight">
              微信助手
            </h3>
            <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              内置 · 微信
            </p>
          </div>
          <Button asChild size="sm" variant="ghost" className="-mr-2 shrink-0">
            <span className="inline-flex items-center gap-1">
              打开
              <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </Button>
        </div>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
        本机读取微信消息，提炼今日重点、画像、待办与定时任务
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={ready ? 'ok' : 'warn'} />
          <span className="text-muted-foreground">
            {ready ? '已就绪' : phaseLabel(phase)}
          </span>
        </span>
        {status?.export?.keyCount ? (
          <span className="text-muted-foreground tabular-nums">
            · {status.export.keyCount} 个密钥
          </span>
        ) : null}
        {status?.im?.enabled ? (
          <span className="text-muted-foreground">· IM 已启用</span>
        ) : null}
      </div>
    </Link>
  );
}

function phaseLabel(phase?: string): string {
  switch (phase) {
    case 'ready':
      return '准备就绪';
    case 'needs-consent':
      return '需要授权';
    case 'needs-env':
      return '环境准备中';
    case 'needs-resign':
      return '需要重签名';
    case 'needs-extract':
      return '恢复密钥';
    case 'needs-restore':
      return '恢复消息';
    case 'unsupported':
      return '平台不支持';
    default:
      return '检测中';
  }
}
