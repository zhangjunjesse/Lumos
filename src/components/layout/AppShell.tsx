"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavRail } from "./NavRail";
import { ChatListPanel } from "./ChatListPanel";
import { RightPanel } from "./RightPanel";
import { ResizeHandle } from "./ResizeHandle";
import { UpdateDialog } from "./UpdateDialog";
import { UpdateBanner } from "./UpdateBanner";
import { DocPreview } from "./DocPreview";
import { ContentPanel } from "./ContentPanel";
import { PanelContext, type PanelContent, type PreviewViewMode } from "@/hooks/usePanel";
import { UpdateContext, type UpdateInfo } from "@/hooks/useUpdate";
import { ImageGenContext, useImageGenState } from "@/hooks/useImageGen";
import { BatchImageGenContext, useBatchImageGenState } from "@/hooks/useBatchImageGen";
import { ErrorBoundary } from "./ErrorBoundary";
import { useContentPanelStore } from "@/stores/content-panel";

const CHATLIST_MIN = 180;
const CHATLIST_MAX = 400;
const RIGHTPANEL_MIN = 200;
const RIGHTPANEL_MAX = 480;
const DOCPREVIEW_MIN = 320;
const DOCPREVIEW_MAX = 800;
const CONTENTPANEL_MIN = 320;
const CONTENTPANEL_MAX = 800;

/** Extensions that default to "rendered" view mode */
const RENDERED_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm"]);

function defaultViewMode(filePath: string): PreviewViewMode {
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
  return RENDERED_EXTENSIONS.has(ext) ? "rendered" : "source";
}

const LG_BREAKPOINT = 1024;
const CHECK_INTERVAL = 8 * 60 * 60 * 1000; // 8 hours
const DISMISSED_VERSION_KEY = "lumos_dismissed_update_version";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tabs, addTab } = useContentPanelStore();
  const initialized = useRef(false);

  // Initialize default file-tree tab if no tabs exist
  useEffect(() => {
    if (!initialized.current && tabs.length === 0) {
      initialized.current = true;
      addTab({
        type: 'file-tree',
        title: 'Files',
        icon: 'folder-02',
        closable: false,
      });
    }
  }, [tabs.length, addTab]);

  const [chatListOpen, setChatListOpenRaw] = useState(() => {
    // Default to closed on mobile (< 1024px), open on desktop
    if (typeof window === "undefined") return false;
    const path = window.location.pathname;
    const isChatRoute = path === "/chat" || path.startsWith("/chat/");
    if (!isChatRoute) return false;
    return window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`).matches;
  });

  // Panel width state with localStorage persistence
  const [chatListWidth, setChatListWidth] = useState(() => {
    if (typeof window === "undefined") return 240;
    return parseInt(localStorage.getItem("lumos_chatlist_width") || "240");
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 288;
    return parseInt(localStorage.getItem("lumos_rightpanel_width") || "288");
  });

  const handleChatListResize = useCallback((delta: number) => {
    setChatListWidth((w) => Math.min(CHATLIST_MAX, Math.max(CHATLIST_MIN, w + delta)));
  }, []);
  const handleChatListResizeEnd = useCallback(() => {
    setChatListWidth((w) => {
      localStorage.setItem("lumos_chatlist_width", String(w));
      return w;
    });
  }, []);

  const handleRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth((w) => Math.min(RIGHTPANEL_MAX, Math.max(RIGHTPANEL_MIN, w - delta)));
  }, []);
  const handleRightPanelResizeEnd = useCallback(() => {
    setRightPanelWidth((w) => {
      localStorage.setItem("lumos_rightpanel_width", String(w));
      return w;
    });
  }, []);

  // Panel state
  const isChatRoute = pathname.startsWith("/chat/") || pathname === "/chat";
  const isChatDetailRoute =
    pathname === "/chat" ||
    pathname.startsWith("/chat/") ||
    pathname.startsWith("/conversations/");

  console.log('[AppShell] Route check:', { pathname, isChatRoute, isChatDetailRoute });

  // Auto-close chat list when leaving chat routes
  const setChatListOpen = useCallback((open: boolean) => {
    setChatListOpenRaw(open);
  }, []);

  useEffect(() => {
    if (!isChatRoute) {
      setChatListOpenRaw(false);
    }
  }, [isChatRoute]);
  const [panelOpen, setPanelOpenRaw] = useState(() => {
    if (typeof window === "undefined") return false;
    const path = window.location.pathname;
    return path === "/chat" || path.startsWith("/chat/");
  });
  const [panelContent, setPanelContent] = useState<PanelContent>("files");
  const [workingDirectory, setWorkingDirectory] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("lumos:last-working-directory") || "";
  });
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [pendingApprovalSessionId, setPendingApprovalSessionId] = useState("");

  // --- Doc Preview state ---
  const [previewFile, setPreviewFileRaw] = useState<string | null>(null);
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>("source");
  const [docPreviewWidth, setDocPreviewWidth] = useState(() => {
    if (typeof window === "undefined") return 480;
    return parseInt(localStorage.getItem("lumos_docpreview_width") || "480");
  });
  const [contentPanelWidth, setContentPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 480;
    return parseInt(localStorage.getItem("lumos_contentpanel_width") || "480");
  });

  const setPreviewFile = useCallback((path: string | null) => {
    setPreviewFileRaw(path);
    if (path) {
      setPreviewViewMode(defaultViewMode(path));
    }
  }, []);

  const handleDocPreviewResize = useCallback((delta: number) => {
    setDocPreviewWidth((w) => Math.min(DOCPREVIEW_MAX, Math.max(DOCPREVIEW_MIN, w - delta)));
  }, []);
  const handleDocPreviewResizeEnd = useCallback(() => {
    setDocPreviewWidth((w) => {
      localStorage.setItem("lumos_docpreview_width", String(w));
      return w;
    });
  }, []);

  const handleContentPanelResize = useCallback((delta: number) => {
    setContentPanelWidth((w) => Math.min(CONTENTPANEL_MAX, Math.max(CONTENTPANEL_MIN, w - delta)));
  }, []);
  const handleContentPanelResizeEnd = useCallback(() => {
    setContentPanelWidth((w) => {
      localStorage.setItem("lumos_contentpanel_width", String(w));
      return w;
    });
  }, []);

  // Auto-open panel on chat detail routes, close on others
  // Also close doc preview when navigating away or switching sessions
  useEffect(() => {
    setPanelOpenRaw(isChatDetailRoute);
    setPreviewFileRaw(null);
  }, [isChatDetailRoute, pathname]);

  const setPanelOpen = useCallback((open: boolean) => {
    setPanelOpenRaw(open);
  }, []);

  // Keep chat list state in sync when resizing across the breakpoint (only on chat routes)
  useEffect(() => {
    if (!isChatRoute) return;
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => setChatListOpenRaw(e.matches);
    mql.addEventListener("change", handler);
    setChatListOpenRaw(mql.matches);
    return () => mql.removeEventListener("change", handler);
  }, [isChatRoute]);

  // --- Skip-permissions indicator ---
  const [skipPermissionsActive, setSkipPermissionsActive] = useState(false);

  const fetchSkipPermissions = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/app");
      if (res.ok) {
        const data = await res.json();
        setSkipPermissionsActive(data.settings?.dangerously_skip_permissions === "true");
      }
    } catch {
      // ignore
    }
  }, []);

  // Re-fetch when window gains focus / becomes visible instead of polling every 5s
  useEffect(() => {
    fetchSkipPermissions();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchSkipPermissions();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", fetchSkipPermissions);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", fetchSkipPermissions);
    };
  }, [fetchSkipPermissions]);

  // --- Update check state ---
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  const isNativeUpdater = typeof window !== "undefined" && !!window.electronAPI?.updater;

  // --- Browser-mode update check (fallback) ---
  const checkForUpdatesBrowser = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/app/updates");
      if (!res.ok) return;
      const data = await res.json();
      const info: UpdateInfo = {
        ...data,
        downloadProgress: null,
        readyToInstall: false,
        isNativeUpdate: false,
      };
      setUpdateInfo(info);

      if (info.updateAvailable) {
        const dismissed = localStorage.getItem(DISMISSED_VERSION_KEY);
        if (dismissed !== info.latestVersion) {
          setShowDialog(true);
        }
      }
    } catch {
      // silently ignore network errors
    } finally {
      setChecking(false);
    }
  }, []);

  // --- Electron native updater check ---
  const checkForUpdatesNative = useCallback(async () => {
    setChecking(true);
    try {
      await window.electronAPI?.updater?.checkForUpdates();
    } catch {
      setChecking(false);
    }
  }, []);

  const checkForUpdates = isNativeUpdater ? checkForUpdatesNative : checkForUpdatesBrowser;

  // Subscribe to native updater IPC events
  useEffect(() => {
    if (!isNativeUpdater) return;

    const unsubscribe = window.electronAPI!.updater!.onStatus((event: any) => {
      switch (event.status) {
        case 'checking':
          setChecking(true);
          break;

        case 'available':
          setChecking(false);
          setUpdateInfo((prev) => {
            const releaseNotes = typeof event.info?.releaseNotes === 'string'
              ? event.info.releaseNotes
              : '';
            const newInfo: UpdateInfo = {
              updateAvailable: true,
              latestVersion: event.info?.version ?? '',
              currentVersion: prev?.currentVersion ?? (process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0'),
              releaseName: event.info?.releaseName ?? `v${event.info?.version}`,
              releaseNotes,
              releaseUrl: `https://github.com/zhangjunjesse/Lumos/releases/tag/v${event.info?.version}`,
              publishedAt: event.info?.releaseDate ?? '',
              downloadProgress: prev?.downloadProgress ?? null,
              readyToInstall: prev?.readyToInstall ?? false,
              isNativeUpdate: true,
            };
            return newInfo;
          });
          // Show dialog if not dismissed
          if (event.info?.version) {
            const dismissed = localStorage.getItem(DISMISSED_VERSION_KEY);
            if (dismissed !== event.info.version) {
              setShowDialog(true);
            }
          }
          break;

        case 'not-available':
          setChecking(false);
          break;

        case 'downloading':
          setUpdateInfo((prev) => prev ? {
            ...prev,
            downloadProgress: event.progress?.percent ?? null,
          } : prev);
          break;

        case 'downloaded':
          setUpdateInfo((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              readyToInstall: true,
              downloadProgress: 100,
            };
          });
          break;

        case 'error':
          setChecking(false);
          // Reset download progress so the download button re-appears
          setUpdateInfo((prev) => prev ? { ...prev, downloadProgress: null } : prev);
          console.warn('[updater] Error:', event.error);
          break;
      }
    });

    return unsubscribe;
  }, [isNativeUpdater]);

  // Browser mode: check on mount + every 8 hours
  useEffect(() => {
    if (isNativeUpdater) return;
    checkForUpdatesBrowser();
    const id = setInterval(checkForUpdatesBrowser, CHECK_INTERVAL);
    return () => clearInterval(id);
  }, [isNativeUpdater, checkForUpdatesBrowser]);

  const dismissUpdate = useCallback(() => {
    setShowDialog(false);
  }, []);

  const downloadUpdate = useCallback(async () => {
    // Immediately show downloading state so user gets feedback
    setUpdateInfo((prev) => prev ? { ...prev, downloadProgress: 0 } : prev);
    try {
      await window.electronAPI?.updater?.downloadUpdate();
    } catch (err) {
      console.warn('[updater] Download failed:', err);
      // Reset progress so the download button re-appears
      setUpdateInfo((prev) => prev ? { ...prev, downloadProgress: null } : prev);
    }
  }, []);

  const quitAndInstall = useCallback(() => {
    window.electronAPI?.updater?.quitAndInstall();
  }, []);

  const updateContextValue = useMemo(
    () => ({
      updateInfo,
      checking,
      checkForUpdates,
      downloadUpdate,
      dismissUpdate,
      showDialog,
      setShowDialog,
      quitAndInstall,
    }),
    [updateInfo, checking, checkForUpdates, downloadUpdate, dismissUpdate, showDialog, quitAndInstall]
  );

  const panelContextValue = useMemo(
    () => ({
      panelOpen,
      setPanelOpen,
      panelContent,
      setPanelContent,
      workingDirectory,
      setWorkingDirectory,
      sessionId,
      setSessionId,
      sessionTitle,
      setSessionTitle,
      streamingSessionId,
      setStreamingSessionId,
      pendingApprovalSessionId,
      setPendingApprovalSessionId,
      previewFile,
      setPreviewFile,
      previewViewMode,
      setPreviewViewMode,
    }),
    [panelOpen, setPanelOpen, panelContent, workingDirectory, sessionId, sessionTitle, streamingSessionId, pendingApprovalSessionId, previewFile, setPreviewFile, previewViewMode]
  );

  console.log('[AppShell] Context state:', { panelOpen, workingDirectory, sessionId, pathname });

  const imageGenValue = useImageGenState();
  const batchImageGenValue = useBatchImageGenState();

  return (
    <UpdateContext.Provider value={updateContextValue}>
      <PanelContext.Provider value={panelContextValue}>
        <ImageGenContext.Provider value={imageGenValue}>
        <BatchImageGenContext.Provider value={batchImageGenValue}>
        <TooltipProvider delayDuration={300}>
          <div className="flex h-screen overflow-hidden">
            <NavRail
              chatListOpen={chatListOpen}
              onToggleChatList={() => setChatListOpen(!chatListOpen)}
              hasUpdate={updateInfo?.updateAvailable ?? false}
              readyToInstall={updateInfo?.readyToInstall ?? false}
              skipPermissionsActive={skipPermissionsActive}
            />
            <ErrorBoundary>
              <ChatListPanel open={chatListOpen} width={chatListWidth} />
            </ErrorBoundary>
            {chatListOpen && (
              <ResizeHandle side="left" onResize={handleChatListResize} onResizeEnd={handleChatListResizeEnd} />
            )}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {/* Electron draggable title bar region — matches side panels' mt-10 */}
              <div
                className="h-10 w-full shrink-0"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
              />
              <UpdateBanner />
              <main className="relative flex-1 overflow-hidden">
                <ErrorBoundary>{children}</ErrorBoundary>
              </main>
            </div>
            {isChatDetailRoute && (
              <>
                <ResizeHandle side="right" onResize={handleContentPanelResize} onResizeEnd={handleContentPanelResizeEnd} />
                <ErrorBoundary>
                  <ContentPanel width={contentPanelWidth} />
                </ErrorBoundary>
              </>
            )}
          </div>
          <UpdateDialog />
        </TooltipProvider>
        </BatchImageGenContext.Provider>
        </ImageGenContext.Provider>
      </PanelContext.Provider>
    </UpdateContext.Provider>
  );
}
