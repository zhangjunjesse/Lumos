"use client";

import { useEffect, useCallback } from 'react';
import type {
  BrowserEventName,
  BrowserOpenRequest,
  BrowserPanelTabData,
  BrowserTab as NativeBrowserTab,
} from '@/types/browser';
import { HugeiconsIcon } from '@hugeicons/react';
import { StructureFolderIcon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useContentPanelStore, type Tab } from '@/stores/content-panel';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import { TabBar } from './TabBar';
import { ContentRenderer } from './ContentRenderer';

interface ContentPanelProps {
  width?: number;
}

const FILE_TREE_TAB_ID = 'fixed-file-tree';
const BROWSER_SYNC_EVENTS = new Set<BrowserEventName>([
  'tab-created',
  'tab-closed',
  'tab-switched',
  'tab-loaded',
  'tab-loading',
  'tab-error',
  'tab-url-updated',
  'tab-title-updated',
  'tab-favicon-updated',
]);

function getBrowserTabTitle(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    return hostname || fallback;
  } catch {
    return fallback;
  }
}

function getBrowserTabData(data: unknown): BrowserPanelTabData {
  return (data as BrowserPanelTabData | undefined) || {};
}

function getBrowserPageId(data: unknown): string {
  const pageId = getBrowserTabData(data).pageId;
  return typeof pageId === 'string' ? pageId.trim() : '';
}

function getNativeBrowserTitle(tab: NativeBrowserTab, fallback: string): string {
  const title = tab.title.trim();
  return title || getBrowserTabTitle(tab.url, fallback);
}

export function ContentPanel({ width = 288 }: ContentPanelProps) {
  const { tabs, activeTabId, setActiveTab, removeTab, addTab, updateTab } = useContentPanelStore();
  const { contentPanelOpen, setContentPanelOpen } = usePanel();
  const { t } = useTranslation();

  // 初始化固定的 FileTree 标签（只在挂载时运行一次）
  useEffect(() => {
    // 查找所有 file-tree 类型的标签
    const fileTreeTabs = tabs.filter(t => t.type === 'file-tree');

    if (fileTreeTabs.length > 1) {
      // 如果有多个 file-tree 标签，只保留第一个，删除其他的
      fileTreeTabs.slice(1).forEach(tab => {
        removeTab(tab.id);
      });

      // 更新第一个标签的 id 和 title
      const firstTab = fileTreeTabs[0];
      if (firstTab.id !== FILE_TREE_TAB_ID) {
        removeTab(firstTab.id);
        addTab({
          id: FILE_TREE_TAB_ID,
          type: 'file-tree',
          title: t('panel.files'),
          closable: false,
        });
      }
    } else if (fileTreeTabs.length === 0) {
      // 如果没有 file-tree 标签，创建一个
      addTab({
        id: FILE_TREE_TAB_ID,
        type: 'file-tree',
        title: t('panel.files'),
        closable: false,
      });
    } else {
      // 如果只有一个，确保它的 id 和 title 正确
      const tab = fileTreeTabs[0];
      if (tab.id !== FILE_TREE_TAB_ID || tab.title !== t('panel.files')) {
        removeTab(tab.id);
        addTab({
          id: FILE_TREE_TAB_ID,
          type: 'file-tree',
          title: t('panel.files'),
          closable: false,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closePanelTab = useCallback(async (tab: Tab) => {
    if (tab.type === 'browser') {
      const pageId = getBrowserPageId(tab.data);
      if (pageId && window.electronAPI?.browser?.closeTab) {
        try {
          const closed = await window.electronAPI.browser.closeTab(pageId);
          if (!closed.success) {
            console.error('[ContentPanel] Failed to close native browser tab:', closed.error);
            return;
          }
        } catch (error) {
          console.error('[ContentPanel] Failed to close native browser tab:', error);
          return;
        }
      }
    }

    removeTab(tab.id);
  }, [removeTab]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modKey = isMac ? e.metaKey : e.ctrlKey;

    // Cmd/Ctrl + T: Add new tab (Settings by default)
    if (modKey && e.key === 't') {
      e.preventDefault();
      addTab({
        type: 'settings',
        title: 'Settings',
        closable: true,
      });
      return;
    }

    // Cmd/Ctrl + 1-9: Switch to tab by index
    if (modKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const index = parseInt(e.key) - 1;
      if (tabs[index]) {
        setActiveTab(tabs[index].id);
      }
      return;
    }

    // Cmd/Ctrl + W: Close current tab
    if (modKey && e.key === 'w') {
      e.preventDefault();
      if (activeTabId) {
        const tab = tabs.find((t: Tab) => t.id === activeTabId);
        if (tab?.closable) {
          void closePanelTab(tab);
        }
      }
      return;
    }

    // Cmd/Ctrl + Shift + [: Previous tab
    if (modKey && e.shiftKey && e.key === '[') {
      e.preventDefault();
      if (activeTabId && tabs.length > 1) {
        const currentIndex = tabs.findIndex((t: Tab) => t.id === activeTabId);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
        setActiveTab(tabs[prevIndex].id);
      }
      return;
    }

    // Cmd/Ctrl + Shift + ]: Next tab
    if (modKey && e.shiftKey && e.key === ']') {
      e.preventDefault();
      if (activeTabId && tabs.length > 1) {
        const currentIndex = tabs.findIndex((t: Tab) => t.id === activeTabId);
        const nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
        setActiveTab(tabs[nextIndex].id);
      }
      return;
    }
  }, [tabs, activeTabId, setActiveTab, addTab, closePanelTab]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const syncBrowserPanelTabs = useCallback(async () => {
    const api = window.electronAPI?.browser;
    if (!api?.getTabs) {
      return;
    }

    try {
      const result = await api.getTabs();
      if (!result.success || !Array.isArray(result.tabs)) {
        return;
      }

      const nativeTabs = new Map(result.tabs.map((tab) => [tab.id, tab]));

      tabs.forEach((tab) => {
        if (tab.type !== 'browser') {
          return;
        }

        const data = getBrowserTabData(tab.data);
        const pageId = getBrowserPageId(tab.data);
        if (!pageId) {
          return;
        }

        const nativeTab = nativeTabs.get(pageId);
        if (!nativeTab) {
          removeTab(tab.id);
          return;
        }

        const nextUrl = nativeTab.url || data.url || '';
        const nextTitle = getNativeBrowserTitle(nativeTab, t('tab.browser'));
        if (
          tab.title === nextTitle
          && data.url === nextUrl
          && data.isLoading === nativeTab.isLoading
          && data.canGoBack === nativeTab.canGoBack
          && data.canGoForward === nativeTab.canGoForward
        ) {
          return;
        }

        updateTab(tab.id, {
          title: nextTitle,
          data: {
            ...data,
            pageId,
            url: nextUrl,
            isLoading: nativeTab.isLoading,
            canGoBack: nativeTab.canGoBack,
            canGoForward: nativeTab.canGoForward,
          },
        });
      });
    } catch (error) {
      console.error('[ContentPanel] Failed to sync browser tabs:', error);
    }
  }, [removeTab, t, tabs, updateTab]);

  const handleOpenBrowserUrl = useCallback(async ({ url, pageId }: BrowserOpenRequest) => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) return;

    setContentPanelOpen(true);

    let resolvedPageId = typeof pageId === 'string' ? pageId.trim() : '';
    const api = window.electronAPI?.browser;

    if (!resolvedPageId) {
      if (!api?.createTab) {
        console.error('[ContentPanel] Browser API is unavailable for native tab creation');
        return;
      }

      try {
        const created = await api.createTab(normalizedUrl);
        if (!created.success || !created.tabId) {
          console.error('[ContentPanel] Failed to create native browser tab:', created.error);
          return;
        }

        resolvedPageId = created.tabId;
        if (api.switchTab) {
          const switched = await api.switchTab(resolvedPageId);
          if (!switched.success) {
            console.warn('[ContentPanel] Failed to activate native browser tab:', switched.error);
          }
        }
      } catch (error) {
        console.error('[ContentPanel] Failed to create native browser tab:', error);
        return;
      }
    }

    const existingByPage = tabs.find((tab) => {
      if (tab.type !== 'browser') return false;
      return getBrowserPageId(tab.data) === resolvedPageId;
    });

    if (existingByPage) {
      const currentData = getBrowserTabData(existingByPage.data);
      updateTab(existingByPage.id, {
        title: getBrowserTabTitle(normalizedUrl, t('tab.browser')),
        data: { ...currentData, url: normalizedUrl, pageId: resolvedPageId },
      });
      setActiveTab(existingByPage.id);
      return;
    }

    const activeBrowserTab = tabs.find((tab) => tab.id === activeTabId && tab.type === 'browser');
    const fitWidth = getBrowserTabData(activeBrowserTab?.data).fitWidth ?? false;

    addTab({
      type: 'browser',
      title: getBrowserTabTitle(normalizedUrl, t('tab.browser')),
      closable: true,
      data: {
        url: normalizedUrl,
        fitWidth,
        pageId: resolvedPageId,
      },
    });
  }, [activeTabId, addTab, setActiveTab, setContentPanelOpen, t, tabs, updateTab]);

  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (!api?.onOpenInContentTab) {
      return;
    }

    return api.onOpenInContentTab(({ url, pageId }) => {
      void handleOpenBrowserUrl({ url, pageId });
    });
  }, [handleOpenBrowserUrl]);

  useEffect(() => {
    const onOpenFromMcp = (event: Event) => {
      const detail = (event as CustomEvent<BrowserOpenRequest | undefined>).detail;
      const url = typeof detail?.url === 'string' ? detail.url : '';
      const pageId = typeof detail?.pageId === 'string' ? detail.pageId : undefined;
      if (!url) return;
      void handleOpenBrowserUrl({ url, pageId });
    };

    window.addEventListener('lumos:browser-open-url', onOpenFromMcp as EventListener);
    return () => {
      window.removeEventListener('lumos:browser-open-url', onOpenFromMcp as EventListener);
    };
  }, [handleOpenBrowserUrl]);

  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (!api?.onEvent) {
      return;
    }

    void syncBrowserPanelTabs();

    return api.onEvent((event) => {
      if (!BROWSER_SYNC_EVENTS.has(event)) {
        return;
      }
      void syncBrowserPanelTabs();
    });
  }, [syncBrowserPanelTabs]);

  // 收缩状态下的窄条
  if (!contentPanelOpen) {
    return (
      <div className="flex flex-col items-center gap-2 bg-background p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setContentPanelOpen(true)}
            >
              <HugeiconsIcon icon={StructureFolderIcon} className="h-4 w-4" />
              <span className="sr-only">{t('contentPanel.openPanel')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t('contentPanel.openPanel')}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden bg-background"
      style={{ width }}
    >
      {tabs.length > 0 ? (
        <>
          <TabBar />
          <ContentRenderer />
        </>
      ) : (
        <EmptyState />
      )}
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-4 text-center">
      <div className="text-sm text-muted-foreground">
        <p>No content to display</p>
        <p className="mt-2">Click + to add a tab</p>
      </div>
    </div>
  );
}
