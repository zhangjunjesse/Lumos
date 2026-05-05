'use client';

import * as React from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface DemoReviewBannerProps {
  confirming: boolean;
  onConfirm: () => void;
}

export function DemoReviewBanner({
  confirming,
  onConfirm,
}: DemoReviewBannerProps): React.ReactElement {
  return (
    <div className="border-b border-amber-500/20 bg-gradient-to-r from-amber-500/[0.06] via-amber-500/[0.03] to-transparent px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">
            Demo 已生成，请先走一遍核心流程
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            到「预览」tab 点一遍主要功能。如果业务流程对，点右侧确认进入完整开发；
            如果不对，直接在底部告诉助手哪里要调整。
          </div>
        </div>
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={confirming}
          className="h-8 shrink-0 px-3 text-xs"
        >
          <CheckCircle2 data-icon="inline-start" className="size-3.5" />
          {confirming ? '提交中…' : '确认 Demo，开始完整开发'}
        </Button>
      </div>
    </div>
  );
}
