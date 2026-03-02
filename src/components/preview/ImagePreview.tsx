/**
 * Image preview component
 * Displays images with proper sizing and error handling
 */
'use client';

import { useState } from 'react';
import { getFileUrl } from '@/lib/file-categories';

interface ImagePreviewProps {
  filePath: string;
  baseDir?: string;
}

export function ImagePreview({ filePath, baseDir }: ImagePreviewProps) {
  const [error, setError] = useState(false);
  const url = getFileUrl(filePath, baseDir);

  if (error) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Failed to load image
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-4">
      <img
        src={url}
        alt={filePath.split('/').pop() || 'Image'}
        className="max-w-full max-h-[calc(100vh-200px)] object-contain"
        onError={() => setError(true)}
      />
    </div>
  );
}
