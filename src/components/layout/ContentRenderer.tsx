"use client";

import { useCallback, useEffect, useRef } from 'react';
import type { BrowserPanelTabData } from '@/types/browser';
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

function getBrowserTabData(data: unknown): BrowserPanelTabData {
  return (data as BrowserPanelTabData | undefined) || {};
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

  const createNativeBrowserTab = useCallback(async (url?: string) => {
    const api = window.electronAPI?.browser;
    if (!api?.createTab) {
      throw new Error('Browser API is unavailable');
    }

    const created = await api.createTab(url);
    if (!created.success || !created.tabId) {
      throw new Error(created.error || 'Failed to create browser tab');
    }

    if (api.switchTab) {
      const switched = await api.switchTab(created.tabId);
      if (!switched.success) {
        console.warn('[ContentRenderer] Failed to activate created browser tab:', switched.error);
      }
    }

    return created.tabId;
  }, []);

  const handleBrowserUrlChange = useCallback(async (tabId: string, url: string) => {
    const currentTab = tabs.find((tab) => tab.id === tabId);
    const currentData = getBrowserTabData(currentTab?.data);
    const pageId = typeof currentData.pageId === 'string' ? currentData.pageId : '';
    const api = window.electronAPI?.browser;

    try {
      if (pageId && api?.navigate) {
        if (api.switchTab) {
          const switched = await api.switchTab(pageId);
          if (!switched.success) {
            console.warn('[ContentRenderer] Failed to focus browser tab before navigate:', switched.error);
          }
        }

        const navigated = await api.navigate(pageId, url);
        if (!navigated.success) {
          throw new Error(navigated.error || 'Failed to navigate browser tab');
        }
      } else {
        const nextPageId = await createNativeBrowserTab(url);
        updateTab(tabId, {
          title: getBrowserTabTitle(url, t('tab.browser')),
          data: { ...currentData, pageId: nextPageId, url },
        });
        return;
      }

      updateTab(tabId, {
        title: getBrowserTabTitle(url, t('tab.browser')),
        data: { ...currentData, url },
      });
    } catch (error) {
      console.error('[ContentRenderer] Failed to navigate browser tab:', error);
    }
  }, [createNativeBrowserTab, tabs, t, updateTab]);

  const handleBrowserReload = useCallback(async (tabId: string) => {
    const api = window.electronAPI?.browser;
    const currentTab = tabs.find((tab) => tab.id === tabId);
    const currentData = getBrowserTabData(currentTab?.data);
    const pageId = typeof currentData.pageId === 'string' ? currentData.pageId : '';
    const url = typeof currentData.url === 'string' ? currentData.url : '';

    if (!pageId || !api?.navigate) {
      if (url) {
        await handleBrowserUrlChange(tabId, url);
      }
      return;
    }

    try {
      if (api.switchTab) {
        const switched = await api.switchTab(pageId);
        if (!switched.success) {
          console.warn('[ContentRenderer] Failed to focus browser tab before reload:', switched.error);
        }
      }

      if (api.sendCDPCommand) {
        const reloaded = await api.sendCDPCommand(pageId, 'Page.reload', {});
        if (!reloaded.success) {
          throw new Error(reloaded.error || 'Failed to reload browser tab');
        }
        return;
      }

      const navigated = await api.navigate(pageId, url, 30_000);
      if (!navigated.success) {
        throw new Error(navigated.error || 'Failed to reload browser tab');
      }
    } catch (error) {
      console.error('[ContentRenderer] Failed to reload browser tab:', error);
    }
  }, [handleBrowserUrlChange, tabs]);

  const handleBrowserFitWidthChange = useCallback((tabId: string, fitWidth: boolean) => {
    const currentTab = tabs.find((tab) => tab.id === tabId);
    const currentData = getBrowserTabData(currentTab?.data);
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

  const handleCreateBrowserTab = useCallback(async (fromTabId: string, url: string) => {
    const fromTab = tabs.find((tab) => tab.id === fromTabId);
    const fromData = getBrowserTabData(fromTab?.data);

    try {
      const pageId = await createNativeBrowserTab(url);
      addTab({
        type: 'browser',
        title: getBrowserTabTitle(url, t('tab.browser')),
        closable: true,
        data: {
          pageId,
          url,
          fitWidth: fromData.fitWidth,
        },
      });
    } catch (error) {
      console.error('[ContentRenderer] Failed to open browser tab:', error);
    }
  }, [addTab, createNativeBrowserTab, t, tabs]);

  const handleOpenFavoriteUrl = useCallback(async (url: string) => {
    const normalized = url.trim();
    if (!normalized) return;

    const activeBrowserTab = tabs.find((tab) => tab.id === activeTabId && tab.type === 'browser');
    const fitWidth = getBrowserTabData(activeBrowserTab?.data).fitWidth ?? true;

    try {
      const pageId = await createNativeBrowserTab(normalized);
      addTab({
        type: 'browser',
        title: getBrowserTabTitle(normalized, t('tab.browser')),
        closable: true,
        data: { pageId, url: normalized, fitWidth },
      });
    } catch (error) {
      console.error('[ContentRenderer] Failed to open favorite URL in browser:', error);
    }
  }, [activeTabId, addTab, createNativeBrowserTab, t, tabs]);

  const activeTab = tabs.find((t: Tab) => t.id === activeTabId);
  const browserTabs = tabs.filter((tab) => tab.type === 'browser');
  const activeTabType = activeTab?.type || null;
  const activeBrowserTab = activeTabType === 'browser'
    ? tabs.find((tab) => tab.id === activeTabId && tab.type === 'browser') || null
    : null;
  const activeBrowserData = getBrowserTabData(activeBrowserTab?.data);
  const hasActiveBrowserTab = Boolean(activeBrowserTab);
  const activeBrowserPageId = typeof activeBrowserData.pageId === 'string' ? activeBrowserData.pageId : '';
  const activeBrowserUrl = typeof activeBrowserData.url === 'string' ? activeBrowserData.url : '';
  const activeBrowserFitWidth = activeBrowserData.fitWidth !== false;
  const activeBrowserFitWidthValue = activeBrowserData.fitWidth;

  useEffect(() => {
    const api = window.electronAPI?.browser;
    if (!api?.switchTab || !api?.createTab) {
      return;
    }

    if (!contentPanelOpen || activeTabType !== 'browser' || !activeTabId || !hasActiveBrowserTab) {
      return;
    }
    const pageId = activeBrowserPageId;
    const targetUrl = activeBrowserUrl;

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

      const created = await api.createTab(targetUrl || undefined);
      if (cancelled || !created.success || !created.tabId) return;
      if (api.switchTab) {
        const switched = await api.switchTab(created.tabId);
        if (cancelled || !switched.success) return;
      }
      updateTab(activeTabId, {
        data: {
          pageId: created.tabId,
          url: targetUrl || activeBrowserUrl || 'about:blank',
          fitWidth: activeBrowserFitWidthValue,
        },
      });
    })().catch((error) => {
      console.error('[ContentRenderer] Failed to create browser tab for panel binding:', error);
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeBrowserFitWidthValue,
    activeBrowserPageId,
    activeBrowserUrl,
    activeTabId,
    activeTabType,
    contentPanelOpen,
    hasActiveBrowserTab,
    updateTab,
  ]);

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

    const pageId = activeBrowserPageId;
    const shouldFitWidth = activeBrowserFitWidth;
    const canUseViewportCdp = Boolean(
      pageId
      && activeBrowserUrl
      && activeBrowserUrl !== 'about:blank',
    );
    let cancelled = false;

    const findBoundsTarget = () => {
      const activeBrowserContainer = rootHost.querySelector(`[data-browser-tab-id="${activeTabId}"]`);
      const nativeHost = activeBrowserContainer?.querySelector('[data-browser-native-host="true"]');
      return (nativeHost as HTMLElement | null) || rootHost;
    };

    const syncViewportMode = async (rect: DOMRect) => {
      if (!pageId || !api.sendCDPCommand) {
        return;
      }

      if (!canUseViewportCdp) {
        if (api.setZoomFactor) {
          await api.setZoomFactor(pageId, 1);
        }
        return;
      }

      try {
        if (api.isCDPConnected) {
          const status = await api.isCDPConnected(pageId);
          if (!status.success) {
            throw new Error(status.error || 'Failed to check CDP connection state');
          }
          if (!status.connected && api.connectCDP) {
            await api.connectCDP(pageId);
          }
        } else if (api.connectCDP) {
          await api.connectCDP(pageId);
        }
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

      if (canUseViewportCdp && pageId && api.sendCDPCommand) {
        void Promise.resolve()
          .then(async () => {
            if (!api.isCDPConnected) {
              if (api.connectCDP) {
                await api.connectCDP(pageId);
              }
              return;
            }

            const status = await api.isCDPConnected(pageId);
            if (!status.success) {
              throw new Error(status.error || 'Failed to check CDP connection state');
            }
            if (!status.connected && api.connectCDP) {
              await api.connectCDP(pageId);
            }
          })
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
  }, [activeBrowserFitWidth, activeBrowserPageId, activeBrowserUrl, activeTabId, activeTabType, contentPanelOpen]);

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
            url={getBrowserTabData(tab.data).url}
            fitWidth={getBrowserTabData(tab.data).fitWidth}
            isLoading={getBrowserTabData(tab.data).isLoading}
            onUrlChange={(url) => void handleBrowserUrlChange(tab.id, url)}
            onReload={() => void handleBrowserReload(tab.id)}
            onOpenInNewTab={(url) => void handleCreateBrowserTab(tab.id, url)}
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
      return (
        <FeishuPanel
          onOpenDoc={handleOpenFeishuDoc}
          onAddToLibrary={handleImportFeishuDoc}
          showConfigCard={false}
        />
      );

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
