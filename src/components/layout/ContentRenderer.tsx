"use client";

import { useCallback, useEffect, useRef } from 'react';
import { useContentPanelStore, type Tab } from '@/stores/content-panel';
import { FileTree } from '@/components/project/FileTree';
import { EmbeddedBrowserPanel } from '@/components/browser/EmbeddedBrowserPanel';
import { FavoritesPanel } from '@/components/favorites/FavoritesPanel';
import { FeishuDocPreview } from '@/components/feishu/FeishuDocPreview';
import { FeishuPanel, type FeishuDocItem } from '@/components/feishu/FeishuPanel';
import { DocPreview } from './DocPreview';
import { usePanel } from '@/hooks/usePanel';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { importDirectory, importLocalFile, importFeishuDoc, importUrl } from '@/lib/knowledge/client';

const BROWSER_BASE_WIDTH = 1366;

const CLEAR_FIT_WIDTH_SCRIPT = `(() => {
  const root = document.documentElement;
  if (!root) return false;
  root.style.zoom = '';
  root.style.transformOrigin = '';
  delete root.dataset.lumosWidthMode;
  return true;
})()`;

function getBrowserTabTitle(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    return hostname || fallback;
  } catch {
    return fallback;
  }
}

interface BrowserTabData {
  url?: string;
  fitWidth?: boolean;
  pageId?: string;
}

export function ContentRenderer() {
  const { tabs, activeTabId, addTab, setActiveTab, updateTab } = useContentPanelStore();
  const { workingDirectory, setPreviewFile, sessionId, contentPanelOpen } = usePanel();
  const { t } = useTranslation();
  const rendererHostRef = useRef<HTMLDivElement | null>(null);

  const handleFileAdd = useCallback((path: string) => {
    window.dispatchEvent(new CustomEvent('attach-file-to-chat', { detail: { path } }));
  }, []);

  const handleFileAddToLibrary = useCallback(async (path: string) => {
    try {
      await importLocalFile(path);
    } catch (error) {
      console.error('[ContentRenderer] Failed to add file to library:', error);
    }
  }, []);

  const handleFolderAddToLibrary = useCallback(async (dir: string) => {
    try {
      await importDirectory({ directory: dir, baseDir: dir, recursive: true, mode: 'ingest' });
    } catch (error) {
      console.error('[ContentRenderer] Failed to add folder to library:', error);
    }
  }, []);

  const handleOpenFeishuDoc = useCallback((doc: FeishuDocItem) => {
    const existing = tabs.find(
      (tab) =>
        tab.type === 'feishu-doc-preview' &&
        ((tab.data as { token?: string } | undefined)?.token === doc.token),
    );
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

    addTab({
      type: 'feishu-doc-preview',
      title: doc.title || 'Feishu Doc',
      closable: true,
      data: {
        token: doc.token,
        type: doc.type,
        url: doc.url,
        updatedTime: doc.updatedTime,
      },
    });
  }, [tabs, addTab, setActiveTab]);

  const handleAttachFeishuDoc = useCallback(async (doc: FeishuDocItem) => {
    if (!sessionId) {
      throw new Error('No active session');
    }

    const res = await fetch('/api/feishu/docs/attach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        token: doc.token,
        type: doc.type,
        title: doc.title,
        url: doc.url,
        mode: 'reference',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message || data?.error || 'Attach failed');
    }
    if (!data.filePath) {
      throw new Error('Missing filePath');
    }

    window.dispatchEvent(
      new CustomEvent('attach-file-to-chat', { detail: { path: data.filePath } }),
    );
  }, [sessionId]);

  const handleImportFeishuDoc = useCallback(async (doc: FeishuDocItem) => {
    try {
      await importFeishuDoc({
        token: doc.token,
        type: doc.type,
        title: doc.title,
        url: doc.url,
        sessionId: sessionId || undefined,
      });
    } catch (error) {
      console.error('[ContentRenderer] Failed to add Feishu doc to library:', error);
    }
  }, [sessionId]);

  const handleBrowserUrlChange = useCallback((tabId: string, url: string) => {
    const currentTab = tabs.find((tab) => tab.id === tabId);
    const currentData = (currentTab?.data as Record<string, unknown> | undefined) || {};
    updateTab(tabId, {
      title: getBrowserTabTitle(url, t('tab.browser')),
      data: { ...currentData, url },
    });
  }, [tabs, t, updateTab]);

  const handleBrowserFitWidthChange = useCallback((tabId: string, fitWidth: boolean) => {
    const currentTab = tabs.find((tab) => tab.id === tabId);
    const currentData = (currentTab?.data as Record<string, unknown> | undefined) || {};
    updateTab(tabId, {
      data: { ...currentData, fitWidth },
    });
  }, [tabs, updateTab]);

  const handleAddBrowserUrlToLibrary = useCallback(async (url: string) => {
    try {
      await importUrl(url);
    } catch (error) {
      console.error('[ContentRenderer] Failed to add URL to library:', error);
    }
  }, []);

  const handleCreateBrowserTab = useCallback((fromTabId: string, url: string) => {
    const fromTab = tabs.find((tab) => tab.id === fromTabId);
    const fromData = (fromTab?.data as { fitWidth?: boolean } | undefined) || {};
    addTab({
      type: 'browser',
      title: getBrowserTabTitle(url, t('tab.browser')),
      closable: true,
      data: {
        url,
        fitWidth: fromData.fitWidth,
      },
    });
  }, [addTab, t, tabs]);

  const handleOpenFavoriteUrl = useCallback((url: string) => {
    const normalized = url.trim();
    if (!normalized) return;

    const existingBrowserTab = tabs.find((tab) => {
      if (tab.type !== 'browser') return false;
      return ((tab.data as { url?: string } | undefined)?.url || '') === normalized;
    });
    if (existingBrowserTab) {
      setActiveTab(existingBrowserTab.id);
      return;
    }

    const activeBrowserTab = tabs.find((tab) => tab.id === activeTabId && tab.type === 'browser');
    const fitWidth = (activeBrowserTab?.data as { fitWidth?: boolean } | undefined)?.fitWidth ?? true;
    addTab({
      type: 'browser',
      title: getBrowserTabTitle(normalized, t('tab.browser')),
      closable: true,
      data: { url: normalized, fitWidth },
    });
  }, [activeTabId, addTab, setActiveTab, t, tabs]);

  const activeTab = tabs.find((t: Tab) => t.id === activeTabId);
  const browserTabs = tabs.filter((tab) => tab.type === 'browser');
  const activeTabType = activeTab?.type || null;

  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (!api?.switchTab || !api?.createTab) {
      return;
    }

    if (!contentPanelOpen || activeTabType !== 'browser' || !activeTabId) {
      return;
    }

    const currentTab = tabs.find((tab) => tab.id === activeTabId && tab.type === 'browser');
    if (!currentTab) return;
    const tabData = (currentTab.data as BrowserTabData | undefined) || {};
    const pageId = typeof tabData.pageId === 'string' ? tabData.pageId : '';
    const targetUrl = typeof tabData.url === 'string' ? tabData.url : '';

    let cancelled = false;

    (async () => {
      if (pageId) {
        const switched = await api.switchTab(pageId);
        if (cancelled) return;
        if (switched?.success) {
          return;
        }
        console.warn('[ContentRenderer] Failed to switch browser tab, recreating binding:', switched?.error);
      }

      if (!targetUrl) {
        return;
      }

      const created = await api.createTab(targetUrl);
      if (cancelled || !created.success || !created.tabId) return;
      const currentData = (currentTab.data as Record<string, unknown> | undefined) || {};
      updateTab(currentTab.id, {
        data: { ...currentData, pageId: created.tabId },
      });
    })().catch((error) => {
      console.error('[ContentRenderer] Failed to create browser tab for panel binding:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTabId, activeTabType, contentPanelOpen, tabs, updateTab]);

  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (!api?.setDisplayTarget) {
      return;
    }

    const shouldShowBrowserView = Boolean(contentPanelOpen && activeTabType === 'browser');
    const rootHost = rendererHostRef.current;
    if (!shouldShowBrowserView || !rootHost) {
      void api.setDisplayTarget('hidden');
      return;
    }

    const currentTab = tabs.find((tab) => tab.id === activeTabId && tab.type === 'browser');
    const currentData = (currentTab?.data as BrowserTabData | undefined) || {};
    const pageId = typeof currentData.pageId === 'string' ? currentData.pageId : '';
    const shouldFitWidth = currentData.fitWidth !== false;
    let cancelled = false;

    const findBoundsTarget = () => {
      const activeBrowserContainer = rootHost.querySelector(`[data-browser-tab-id="${activeTabId}"]`);
      const nativeHost = activeBrowserContainer?.querySelector('[data-browser-native-host="true"]');
      return (nativeHost as HTMLElement | null) || rootHost;
    };

    const syncViewportMode = async (rect: DOMRect) => {
      if (!pageId || !api.connectCDP || !api.sendCDPCommand) {
        return;
      }

      try {
        await api.connectCDP(pageId);
        if (cancelled) return;

        if (shouldFitWidth) {
          const scale = Math.min(1, rect.width / BROWSER_BASE_WIDTH);
          const emulatedHeight = Math.max(1, Math.round(rect.height));
          await api.sendCDPCommand(pageId, 'Emulation.setDeviceMetricsOverride', {
            mobile: false,
            width: BROWSER_BASE_WIDTH,
            height: emulatedHeight,
            deviceScaleFactor: 1,
          });
          if (cancelled) return;
          await api.sendCDPCommand(pageId, 'Runtime.evaluate', {
            expression: CLEAR_FIT_WIDTH_SCRIPT,
            awaitPromise: false,
          });
          if (cancelled) return;
          if (api.setZoomFactor) {
            await api.setZoomFactor(pageId, scale);
          }
          return;
        }

        await api.sendCDPCommand(pageId, 'Emulation.clearDeviceMetricsOverride', {});
        if (cancelled) return;
        if (api.setZoomFactor) {
          await api.setZoomFactor(pageId, 1);
        }
        if (cancelled) return;
        await api.sendCDPCommand(pageId, 'Runtime.evaluate', {
          expression: CLEAR_FIT_WIDTH_SCRIPT,
          awaitPromise: false,
        });
      } catch (error) {
        console.error('[ContentRenderer] Failed to sync browser viewport mode:', error);
      }
    };

    const syncBounds = () => {
      const boundsTarget = findBoundsTarget();
      const rect = boundsTarget.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        void api.setDisplayTarget('hidden');
        return;
      }

      void api.setDisplayTarget('panel', {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });

      void syncViewportMode(rect);
    };

    syncBounds();
    const observer = new ResizeObserver(() => syncBounds());
    observer.observe(findBoundsTarget());
    window.addEventListener('resize', syncBounds);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);

      if (pageId && api.connectCDP && api.sendCDPCommand) {
        void api.connectCDP(pageId)
          .then(() => (api.setZoomFactor ? api.setZoomFactor(pageId, 1) : undefined))
          .then(() => api.sendCDPCommand(pageId, 'Emulation.clearDeviceMetricsOverride', {}))
          .then(() => api.sendCDPCommand(pageId, 'Runtime.evaluate', {
            expression: CLEAR_FIT_WIDTH_SCRIPT,
            awaitPromise: false,
          }))
          .catch((error) => {
            console.error('[ContentRenderer] Failed to reset browser viewport mode:', error);
          });
      }
      void api.setDisplayTarget('hidden');
    };
  }, [activeTabId, activeTabType, contentPanelOpen, tabs]);

  if (!activeTab) {
    return null;
  }

  return (
    <div ref={rendererHostRef} className="relative flex-1 overflow-hidden">
      {browserTabs.map((tab) => (
        <div
          key={tab.id}
          data-browser-tab-id={tab.id}
          className={cn('absolute inset-0', tab.id === activeTabId ? 'block' : 'hidden')}
        >
          <EmbeddedBrowserPanel
            url={(tab.data as { url?: string } | undefined)?.url}
            fitWidth={(tab.data as { fitWidth?: boolean } | undefined)?.fitWidth}
            onUrlChange={(url) => handleBrowserUrlChange(tab.id, url)}
            onOpenInNewTab={(url) => handleCreateBrowserTab(tab.id, url)}
            onFitWidthChange={(fitWidth) => handleBrowserFitWidthChange(tab.id, fitWidth)}
            onAddToLibrary={handleAddBrowserUrlToLibrary}
            nativeHost
          />
        </div>
      ))}

      {activeTab.type !== 'browser' && (
        <div className="h-full">
          {renderContent(
            activeTab,
            workingDirectory,
            setPreviewFile,
            handleFileAdd,
            handleFileAddToLibrary,
            handleFolderAddToLibrary,
            handleOpenFeishuDoc,
            handleAttachFeishuDoc,
            handleImportFeishuDoc,
            handleOpenFavoriteUrl,
          )}
        </div>
      )}
    </div>
  );
}

function renderContent(
  tab: Tab,
  workingDirectory: string,
  setPreviewFile: (path: string | null) => void,
  handleFileAdd: (path: string) => void,
  handleFileAddToLibrary: (path: string) => void,
  handleFolderAddToLibrary: (dir: string) => void,
  handleOpenFeishuDoc: (doc: FeishuDocItem) => void,
  handleAttachFeishuDoc: (doc: FeishuDocItem) => Promise<void>,
  handleImportFeishuDoc: (doc: FeishuDocItem) => Promise<void>,
  handleOpenFavoriteUrl: (url: string) => void,
) {
  switch (tab.type) {
    case 'file-tree':
      return (
        <FileTree
          key={workingDirectory}
          workingDirectory={workingDirectory}
          onFileSelect={setPreviewFile}
          onFileAdd={handleFileAdd}
          onFileAddToLibrary={handleFileAddToLibrary}
          onFolderAddToLibrary={handleFolderAddToLibrary}
        />
      );

    case 'feishu-doc':
      return <FeishuPanel onOpenDoc={handleOpenFeishuDoc} onAddToLibrary={handleImportFeishuDoc} />;

    case 'favorites':
      return (
        <FavoritesPanel
          onOpenFile={setPreviewFile}
          onOpenFeishuDoc={handleOpenFeishuDoc}
          onOpenUrl={handleOpenFavoriteUrl}
        />
      );

    case 'browser':
      return null;

    case 'feishu-doc-preview':
      return (
        <FeishuDocPreview
          title={tab.title}
          doc={{
            token: (tab.data as { token?: string } | undefined)?.token || '',
            type: (tab.data as { type?: string } | undefined)?.type || 'docx',
            title: tab.title,
            url: (tab.data as { url?: string } | undefined)?.url || '',
          }}
          url={(tab.data as { url?: string } | undefined)?.url}
          onAddToChat={handleAttachFeishuDoc}
          onAddToLibrary={handleImportFeishuDoc}
        />
      );

    case 'file-preview':
      if (!tab.filePath) {
        return <div className="p-4">No file path specified</div>;
      }
      return (
        <DocPreview
          key={tab.filePath}
          filePath={tab.filePath}
          viewMode={(tab.data as { viewMode?: 'source' | 'rendered' })?.viewMode || 'source'}
          onViewModeChange={(mode) => {
            const currentData = (tab.data as Record<string, unknown>) || {};
            useContentPanelStore.getState().updateTab(tab.id, {
              data: { ...currentData, viewMode: mode },
            });
          }}
          onClose={() => useContentPanelStore.getState().removeTab(tab.id)}
          onAdd={() => handleFileAdd(tab.filePath!)}
          onAddToLibrary={() => handleFileAddToLibrary(tab.filePath!)}
          width={0} // Not used in tab context
        />
      );

    case 'settings':
      return <div className="p-4">Settings (Coming Soon)</div>;

    case 'knowledge':
      return <div className="p-4">Knowledge (Coming Soon)</div>;

    case 'plugins':
      return <div className="p-4">Plugins (Coming Soon)</div>;

    default:
      return <div className="p-4">Unknown tab type: {tab.type}</div>;
  }
}
