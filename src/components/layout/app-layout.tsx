"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { ResizeHandle } from "./ResizeHandle";
import { ErrorBoundary } from "./ErrorBoundary";
import { PanelContext, type PanelContent, type PreviewViewMode } from "@/hooks/usePanel";
import { useContentPanelStore } from "@/stores/content-panel";
import { UpdateProvider } from "./UpdateProvider";
import { UpdateBanner } from "./UpdateBanner";
import { UpdateDialog } from "./UpdateDialog";

const ContentPanel = dynamic(() => import("./ContentPanel").then(m => m.ContentPanel), { ssr: false });

const CONTENTPANEL_MIN = 320;
const CONTENTPANEL_MAX = 800;

const RENDERED_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm"]);

function defaultViewMode(filePath: string): PreviewViewMode {
  const dot = filePath.lastIndexOf(".");
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
  return RENDERED_EXTENSIONS.has(ext) ? "rendered" : "source";
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const isChatRoute = pathname.startsWith("/chat") || pathname.startsWith("/main-agent");

  const [assistantOpen, setAssistantOpen] = useState(false);

  // ContentPanel store
  const { tabs, addTab, setActiveTab } = useContentPanelStore();

  // Panel state - 默认关闭，从 localStorage 恢复后再展开
  const [panelOpen, setPanelOpen] = useState(false);
  const [contentPanelOpen, setContentPanelOpen] = useState(false);

  const [panelContent, setPanelContent] = useState<PanelContent>("files");

  const [workingDirectory, setWorkingDirectory] = useState("");

  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [pendingApprovalSessionId, setPendingApprovalSessionId] = useState("");

  const setPreviewFile = useCallback((path: string | null) => {
    console.log('[app-layout] setPreviewFile called:', path);
    if (!path) return;

    // 检查是否已存在该文件的标签
    const existingTab = tabs.find(tab => tab.type === 'file-preview' && tab.filePath === path);

    if (existingTab) {
      // 如果已存在，切换到该标签
      console.log('[app-layout] Tab already exists, switching to:', existingTab.id);
      setActiveTab(existingTab.id);
      return;
    }

    const fileName = path.split('/').pop() || path;
    const viewMode = defaultViewMode(path);

    console.log('[app-layout] Adding new tab:', { fileName, viewMode, path });

    // 添加到 ContentPanel
    addTab({
      type: 'file-preview',
      title: fileName,
      closable: true,
      filePath: path,
      data: { viewMode },
    });
  }, [tabs, addTab, setActiveTab]);

  // Panel width state - 使用固定初始值避免 hydration 错误
  const [contentPanelWidth, setContentPanelWidth] = useState(480);

  // 在客户端挂载后从 localStorage 恢复状态（one-time hydration）
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedPanelOpen = localStorage.getItem("lumos_panel_open");
    if (savedPanelOpen !== null) {
      setPanelOpen(savedPanelOpen === "true");
    }

    const savedContentPanelOpen = localStorage.getItem("lumos_contentpanel_open");
    if (savedContentPanelOpen !== null) {
      setContentPanelOpen(savedContentPanelOpen === "true");
    }

    const savedWorkingDirectory = localStorage.getItem("lumos_working_directory");
    if (savedWorkingDirectory) {
      setWorkingDirectory(savedWorkingDirectory);
    }

    const savedContentPanelWidth = localStorage.getItem("lumos_contentpanel_width");
    if (savedContentPanelWidth) {
      setContentPanelWidth(parseInt(savedContentPanelWidth));
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleContentPanelResize = useCallback((delta: number) => {
    setContentPanelWidth((w) => Math.min(CONTENTPANEL_MAX, Math.max(CONTENTPANEL_MIN, w - delta)));
  }, []);

  const handleContentPanelResizeEnd = useCallback(() => {
    setContentPanelWidth((w) => {
      localStorage.setItem("lumos_contentpanel_width", String(w));
      return w;
    });
  }, []);

  // Close doc preview on route change (no longer needed, but keep for compatibility)
  useEffect(() => {
    // Temporary tabs are automatically cleared by ContentPanel
  }, [pathname]);

  // Persist panel open state
  useEffect(() => {
    localStorage.setItem("lumos_panel_open", String(panelOpen));
  }, [panelOpen]);

  // Persist content panel open state
  useEffect(() => {
    localStorage.setItem("lumos_contentpanel_open", String(contentPanelOpen));
  }, [contentPanelOpen]);

  // Persist working directory
  useEffect(() => {
    if (workingDirectory) {
      localStorage.setItem("lumos_working_directory", workingDirectory);
      return;
    }
    localStorage.removeItem("lumos_working_directory");
  }, [workingDirectory]);

  const openAssistant = useCallback(() => {
    setAssistantOpen(true);
  }, []);

  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
  }, []);

  const panelContextValue = useMemo(() => ({
    panelOpen,
    setPanelOpen,
    contentPanelOpen,
    setContentPanelOpen,
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
    setPreviewFile, // 保留用于触发文件预览
  }), [panelOpen, contentPanelOpen, panelContent, workingDirectory, sessionId, sessionTitle, streamingSessionId, pendingApprovalSessionId, setPreviewFile]);

  return (
    <UpdateProvider>
      <PanelContext.Provider value={panelContextValue}>
        <TooltipProvider delayDuration={300}>
          <UpdateBanner />
          <UpdateDialog />
          <div className="flex h-screen overflow-hidden">
            <Sidebar onOpenAssistant={openAssistant} />

            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {/* Draggable title bar region */}
              <div
                className="h-10 shrink-0"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
              />

              <TopBar />

              <div className="flex flex-1 overflow-hidden">
                <main className="relative flex-1 overflow-auto">
                  <ErrorBoundary>{children}</ErrorBoundary>
                </main>

                {isChatRoute && (
                  <>
                    {contentPanelOpen && (
                      <ResizeHandle side="right" onResize={handleContentPanelResize} onResizeEnd={handleContentPanelResizeEnd} />
                    )}
                    <ErrorBoundary>
                      <ContentPanel width={contentPanelOpen ? contentPanelWidth : undefined} />
                    </ErrorBoundary>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* AI Assistant modal will be rendered here */}
          {assistantOpen && (
            <AssistantModalLazy onClose={closeAssistant} />
          )}
        </TooltipProvider>
      </PanelContext.Provider>
    </UpdateProvider>
  );
}

/** Lazy-load the assistant modal to keep initial bundle small */
const AssistantModalLazy = dynamic(
  () =>
    import("@/components/ai-assistant/assistant-modal").then(
      (m) => m.AssistantModal
    ),
  { ssr: false, loading: () => null }
);
