'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Cog } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

import type { EcommerceAssistantStatus } from './types';

export function SetupSection({
  status,
  onRefresh,
}: {
  status: EcommerceAssistantStatus | null;
  onRefresh: () => void;
}): React.ReactElement | null {
  if (!status) return null;
  const items = [
    {
      key: 'install',
      label: '应用安装',
      ok: status.install.installed,
      reason: status.install.error ?? '应用未在内置初始化时安装；请重启 Lumos 触发安装。',
      action: null,
    },
    {
      key: 'analysis',
      label: 'AI 分析 provider（识别 brief / 评分 / QC）',
      ok: status.providers.analysis.ok,
      reason: status.providers.analysis.reason ?? '需要支持文本生成的 provider（OpenAI 兼容 / Anthropic）。',
      action: { href: '/settings', label: '前往「设置 → 服务商」' },
    },
    {
      key: 'image',
      label: 'AI 图像 provider（抠图 / 场景 / 终版）',
      ok: status.providers.image.ok,
      reason: status.providers.image.reason ?? '需要支持 image-gen 的 provider（Gemini / 国产兼容 / DashScope 等）。',
      action: { href: '/settings', label: '前往「设置 → 服务商」' },
    },
    {
      key: 'inventory',
      label: '应用数据层',
      ok: status.inventory.ready,
      reason: status.inventory.storeError ?? '应用数据层未就绪。',
      action: null,
    },
  ];
  return (
    <Card className="bg-amber-50/40 ring-1 ring-amber-200 dark:bg-amber-950/20 dark:ring-amber-900">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cog className="size-4" />
          初始化检查
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={onRefresh}>
          重新检查
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.map((item) => (
          <div key={item.key} className="flex items-start gap-3 rounded-md border bg-card p-3">
            <span className="mt-0.5">
              {item.ok ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <AlertCircle className="size-4 text-amber-600" />
              )}
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium">{item.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.ok ? '已就绪' : item.reason}
              </p>
              {!item.ok && item.action ? (
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href={item.action.href}>{item.action.label}</Link>
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
