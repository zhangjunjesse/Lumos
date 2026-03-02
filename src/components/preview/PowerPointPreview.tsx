/**
 * PowerPoint preview component
 * Uses pptx-preview for client-side rendering
 */
'use client';

import { useState, useEffect, useRef } from 'react';

interface PowerPointPreviewProps {
  filePath: string;
  baseDir?: string;
}

export function PowerPointPreview({ filePath, baseDir }: PowerPointPreviewProps) {
  console.log('[PPT] Component rendered with:', { filePath, baseDir });

  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('[PPT] useEffect triggered');
    let cancelled = false;
    let previewer: any = null;

    async function loadPresentation() {
      console.log('[PPT] loadPresentation called, containerRef.current:', !!containerRef.current);

      // Wait for container to be mounted
      if (!containerRef.current) {
        console.log('[PPT] No container ref, waiting for next tick...');
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!containerRef.current || cancelled) {
          console.log('[PPT] Still no container ref after wait, returning');
          return;
        }
      }

      setLoading(true);
      setError(null);

      try {
        console.log('[PPT] Starting to load pptx-preview library...');
        const { init } = await import('pptx-preview');
        if (cancelled) {
          console.log('[PPT] Cancelled after library load');
          return;
        }
        console.log('[PPT] Library loaded successfully');

        const params = new URLSearchParams({ path: filePath });
        if (baseDir) params.set('baseDir', baseDir);
        const url = `/api/files/raw?${params.toString()}`;

        console.log('[PPT] Fetching file from:', url);
        const response = await fetch(url);
        if (cancelled) return;
        if (!response.ok) {
          console.error('[PPT] Fetch failed:', response.status, response.statusText);
          throw new Error(`Failed to fetch presentation: ${response.status}`);
        }
        console.log('[PPT] File fetched, size:', response.headers.get('content-length'));

        const arrayBuffer = await response.arrayBuffer();
        if (cancelled || !containerRef.current) return;
        console.log('[PPT] ArrayBuffer created, size:', arrayBuffer.byteLength);

        containerRef.current.innerHTML = '';

        console.log('[PPT] Initializing previewer...');
        previewer = init(containerRef.current, {
          mode: 'list',
          width: containerRef.current.offsetWidth || 800,
          height: containerRef.current.offsetHeight || 600,
        });
        console.log('[PPT] Previewer initialized:', previewer);

        console.log('[PPT] Calling preview()...');
        await previewer.preview(arrayBuffer);
        if (cancelled) return;
        console.log('[PPT] Preview completed successfully');
      } catch (err) {
        if (cancelled) return;
        console.error('[PPT] Error details:', err);
        console.error('[PPT] Error stack:', err instanceof Error ? err.stack : 'No stack');
        const errorMessage = err instanceof Error ? err.message : 'Failed to load presentation';
        setError(errorMessage);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPresentation();

    return () => {
      console.log('[PPT] Cleanup called');
      cancelled = true;
      if (previewer && previewer.destroy) {
        console.log('[PPT] Destroying previewer');
        previewer.destroy();
      }
    };
  }, [filePath, baseDir]);

  if (error) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto relative bg-background">
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-10 gap-2">
          <div className="text-sm text-muted-foreground">Loading presentation...</div>
          <div className="text-xs text-muted-foreground/60">This may take a moment</div>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-full p-4"
        style={{
          minHeight: '600px',
          minWidth: '100%',
        }}
      />
    </div>
  );
}
