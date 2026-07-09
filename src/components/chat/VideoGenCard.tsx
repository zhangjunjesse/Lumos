'use client';

import { useCallback } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Download, Paintbrush } from '@hugeicons/core-free-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface VideoGenVideo {
  mimeType: string;
  localPath?: string;
  directUrl?: string;
}

interface VideoGenCardProps {
  videos: VideoGenVideo[];
  prompt: string;
  mode?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  model?: string;
  provider?: string;
}

function videoUrl(video: VideoGenVideo): string {
  if (video.directUrl) return video.directUrl;
  if (video.localPath) {
    return `/api/media/serve?path=${encodeURIComponent(video.localPath)}`;
  }
  return '';
}

export function VideoGenCard({
  videos,
  prompt,
  mode,
  aspectRatio,
  resolution,
  duration,
  model,
  provider,
}: VideoGenCardProps) {
  const handleDownload = useCallback(async (video: VideoGenVideo, index: number) => {
    const url = videoUrl(video);
    if (!url) return;
    const ext = video.mimeType.includes('quicktime')
      ? 'mov'
      : video.mimeType.split('/')[1] || 'mp4';
    const filename = `generated-video-${Date.now()}-${index + 1}.${ext}`;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, '_blank');
    }
  }, []);

  if (videos.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-card p-3 space-y-2.5">
      <div className="grid gap-2">
        {videos.map((video, i) => {
          const url = videoUrl(video);
          if (!url) return null;
          return (
            <video
              key={i}
              src={url}
              controls
              preload="metadata"
              className="w-full max-w-lg rounded-md border border-border/30 bg-black"
            />
          );
        })}
      </div>

      <p className="text-sm text-foreground/80 leading-relaxed">{prompt}</p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {provider && (
            <Badge variant="outline" className="text-[10px]">
              {provider}
            </Badge>
          )}
          {model && (
            <Badge variant="secondary" className="text-[10px] gap-1">
              <HugeiconsIcon icon={Paintbrush} className="h-3 w-3" />
              {model}
            </Badge>
          )}
          {mode && (
            <Badge variant="outline" className="text-[10px]">
              {mode}
            </Badge>
          )}
          {aspectRatio && (
            <Badge variant="outline" className="text-[10px]">
              {aspectRatio}
            </Badge>
          )}
          {resolution && (
            <Badge variant="outline" className="text-[10px]">
              {resolution}
            </Badge>
          )}
          {duration ? (
            <Badge variant="outline" className="text-[10px]">
              {duration}s
            </Badge>
          ) : null}
        </div>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => handleDownload(videos[0], 0)}
          title="下载视频"
        >
          <HugeiconsIcon icon={Download} className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
