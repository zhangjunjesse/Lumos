/**
 * Audio preview component
 * Native HTML5 audio player with controls and waveform visualization
 */
'use client';

import { getFileUrl } from '@/lib/file-categories';

interface AudioPreviewProps {
  filePath: string;
  baseDir?: string;
}

export function AudioPreview({ filePath, baseDir }: AudioPreviewProps) {
  const url = getFileUrl(filePath, baseDir);
  const fileName = filePath.split('/').pop() || 'Audio file';

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-4">
      <div className="text-sm font-medium text-foreground">{fileName}</div>
      <audio
        src={url}
        controls
        className="w-full max-w-md"
      >
        Your browser does not support audio playback.
      </audio>
    </div>
  );
}
