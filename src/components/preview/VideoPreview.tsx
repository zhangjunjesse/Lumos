/**
 * Video preview component
 * Native HTML5 video player with controls
 */
'use client';

import { getFileUrl } from '@/lib/file-categories';

interface VideoPreviewProps {
  filePath: string;
  baseDir?: string;
}

export function VideoPreview({ filePath, baseDir }: VideoPreviewProps) {
  const url = getFileUrl(filePath, baseDir);

  return (
    <div className="flex items-center justify-center p-4">
      <video
        src={url}
        controls
        className="max-w-full max-h-[calc(100vh-200px)]"
      >
        Your browser does not support video playback.
      </video>
    </div>
  );
}
