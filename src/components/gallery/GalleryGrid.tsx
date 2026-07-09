'use client';

import { HugeiconsIcon } from '@hugeicons/react';
import { Paintbrush, Favorite } from '@hugeicons/core-free-icons';
import { Play } from 'lucide-react';

export interface GalleryItem {
  id: string;
  type?: 'image' | 'video';
  prompt: string;
  images: Array<{ data?: string; mimeType: string; localPath?: string }>;
  videos?: Array<{ mimeType: string; localPath?: string }>;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  tags: string[];
  favorited?: boolean;
  created_at: string;
  session_id?: string;
  referenceImages?: Array<{ mimeType: string; localPath: string }>;
  referenceVideos?: Array<{ mimeType: string; localPath: string }>;
}

interface GalleryGridProps {
  items: GalleryItem[];
  onSelect: (item: GalleryItem) => void;
}

function mediaUrl(media?: { data?: string; mimeType: string; localPath?: string }): string {
  if (!media) return '';
  if (media.localPath) {
    return `/api/media/serve?path=${encodeURIComponent(media.localPath)}`;
  }
  if (media.data) {
    return `data:${media.mimeType};base64,${media.data}`;
  }
  return '';
}

export function GalleryGrid({ items, onSelect }: GalleryGridProps) {
  return (
    <div
      className="gap-3"
      style={{
        columnCount: 6,
        columnGap: '12px',
      }}
    >
      {items.map((item) => {
        const isVideo = item.type === 'video';
        const url = isVideo ? mediaUrl(item.videos?.[0]) : mediaUrl(item.images[0]);
        const mediaCount = isVideo ? (item.videos?.length || 0) : item.images.length;

        return (
          <div
            key={item.id}
            className="mb-3 cursor-pointer rounded-lg overflow-hidden ring-0 hover:ring-2 hover:ring-border transition-all"
            style={{ breakInside: 'avoid' }}
            onClick={() => onSelect(item)}
          >
            <div className="relative bg-muted/30">
              {url ? (
                isVideo ? (
                  <video
                    src={url}
                    muted
                    preload="metadata"
                    className="block w-full h-auto bg-black"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={item.prompt}
                    className="block w-full h-auto"
                    loading="lazy"
                  />
                )
              ) : (
                <div className="flex aspect-square items-center justify-center">
                  <HugeiconsIcon icon={Paintbrush} className="h-8 w-8 text-muted-foreground/30" />
                </div>
              )}
              {isVideo && (
                <span className="absolute bottom-1.5 left-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white shadow-sm">
                  <Play className="h-3.5 w-3.5 fill-current" />
                </span>
              )}
              {mediaCount > 1 && (
                <span className="absolute top-1.5 right-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] text-white font-medium">
                  {mediaCount}
                </span>
              )}
              {item.favorited && (
                <span className="absolute top-1.5 left-1.5">
                  <HugeiconsIcon icon={Favorite} className="h-4 w-4 text-red-500 drop-shadow" fill="currentColor" />
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
