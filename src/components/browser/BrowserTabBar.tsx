'use client';

import { Loader2, Plus, X } from 'lucide-react';
import type { BrowserTab } from '@/types/browser';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

export interface BrowserTabBarProps {
  tabs: BrowserTab[];
  activeTabId: string | null;
  onSwitchTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreateTab: () => void;
}

function getTabLabel(tab: BrowserTab, newTabText: string): string {
  const title = tab.title.trim();
  if (title) {
    return title;
  }

  try {
    const parsed = new URL(tab.url);
    return parsed.hostname.replace(/^www\./, '') || newTabText;
  } catch {
    return newTabText;
  }
}

export function BrowserTabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onCreateTab,
}: BrowserTabBarProps) {
  const { t } = useTranslation();

  return (
    <div className="border-b border-border/60 bg-muted/35 px-3 py-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => onSwitchTab(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSwitchTab(tab.id);
              }
            }}
            role="button"
            tabIndex={0}
            className={cn(
              'group flex min-w-[180px] max-w-[240px] items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-colors',
              tab.id === activeTabId
                ? 'border-border bg-background text-foreground shadow-sm'
                : 'border-transparent bg-background/55 text-muted-foreground hover:border-border/60 hover:bg-background/90',
            )}
          >
            <div className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
              {tab.isLoading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : tab.favicon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tab.favicon} alt="" className="size-4 rounded-sm object-cover" />
              ) : (
                <span className="text-[11px] font-semibold uppercase">
                  {getTabLabel(tab, t('browser.newTab')).slice(0, 1)}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{getTabLabel(tab, t('browser.newTab'))}</div>
              <div className="truncate text-xs text-muted-foreground">{tab.url || 'about:blank'}</div>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
              title={t('browser.closeTab')}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="shrink-0 rounded-full"
          onClick={onCreateTab}
          title={t('browser.newTab')}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}
