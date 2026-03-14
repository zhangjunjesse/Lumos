'use client';

import { Download, History, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BrowserAiActivity } from '@/types/browser';

interface DownloadEntry {
  id: string;
  fileName: string;
  state: string;
  done: boolean;
  receivedBytes?: number;
  totalBytes?: number;
}

interface BrowserStatusBarProps {
  aiActivity: BrowserAiActivity | null;
  downloads: DownloadEntry[];
  captureEnabled: boolean;
  capturePaused: boolean;
  onOpenPanel: (panel: 'context' | 'workflows' | 'downloads') => void;
}

export function BrowserStatusBar({
  aiActivity,
  downloads,
  captureEnabled,
  capturePaused,
  onOpenPanel,
}: BrowserStatusBarProps) {
  const activeDownloads = downloads.filter((d) => !d.done);
  const hasActivity = aiActivity || activeDownloads.length > 0;

  if (!hasActivity && captureEnabled && !capturePaused) {
    return null; // 无活动时隐藏状态栏
  }

  return (
    <div className="flex items-center justify-between border-t bg-background px-4 py-2">
      {/* 左侧：AI 活动 */}
      <div className="flex items-center gap-3">
        {aiActivity && (
          <Badge variant="outline" className="gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs">{aiActivity.action}</span>
          </Badge>
        )}
      </div>

      {/* 中间：下载进度 */}
      <div className="flex items-center gap-2">
        {activeDownloads.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenPanel('downloads')}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            <span className="text-xs">
              {activeDownloads.length} 个下载中
            </span>
          </Button>
        )}
      </div>

      {/* 右侧：采集状态 */}
      <div className="flex items-center gap-2">
        {captureEnabled && !capturePaused && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenPanel('context')}
            className="gap-2"
          >
            <History className="h-4 w-4" />
            <span className="text-xs">上下文采集中</span>
          </Button>
        )}
      </div>
    </div>
  );
}
