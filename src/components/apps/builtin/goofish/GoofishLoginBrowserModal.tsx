'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ElectronBrowserApi {
  setDisplayTarget?: (
    target: 'default' | 'panel' | 'hidden',
    bounds?: { x: number; y: number; width: number; height: number },
  ) => Promise<unknown> | void;
}

function getBrowserApi(): ElectronBrowserApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { electronAPI?: { browser?: ElectronBrowserApi } };
  return w.electronAPI?.browser ?? null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Embeds the BrowserManager view inside a centered modal. While open we
 * tell BrowserManager to render its active tab inside our content rect
 * (setDisplayTarget('panel', rect)). On close we restore 'hidden' so the
 * browser doesn't leak into other app routes.
 */
export function GoofishLoginBrowserModal({ open, onClose }: Props): React.ReactElement | null {
  const hostRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const api = getBrowserApi();
    if (!api?.setDisplayTarget) return;
    if (!open || !hostRef.current) {
      void api.setDisplayTarget('hidden');
      return;
    }
    const node = hostRef.current;
    let raf = 0;
    const sync = () => {
      const rect = node.getBoundingClientRect();
      if (!rect || rect.width < 2 || rect.height < 2) {
        void api.setDisplayTarget?.('hidden');
        return;
      }
      void api.setDisplayTarget?.('panel', {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    // Defer first sync to next frame so layout has settled.
    raf = window.requestAnimationFrame(sync);
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    window.addEventListener('resize', sync);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('resize', sync);
      void api.setDisplayTarget?.('hidden');
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal
    >
      <div className="flex h-[85vh] w-[90vw] max-w-[1100px] flex-col overflow-hidden rounded-xl bg-background shadow-2xl ring-1 ring-border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-medium">扫码登录闲鱼</p>
            <p className="text-xs text-muted-foreground">
              用闲鱼 App 扫描下面的二维码完成登录。最长等 5 分钟，cookies 会写入应用专属账号目录。
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X />
            关闭
          </Button>
        </div>
        <div ref={hostRef} className="flex-1 bg-muted" />
      </div>
    </div>
  );
}
