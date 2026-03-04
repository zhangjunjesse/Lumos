"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { RightPanel } from "./RightPanel";
import { DocPreview } from "./DocPreview";
import { ResizeHandle } from "./ResizeHandle";
import { ErrorBoundary } from "./ErrorBoundary";
import { PanelContext, type PanelContent, type PreviewViewMode } from "@/hooks/usePanel";

const ContentPanel = dynamic(() => import("./ContentPanel").then(m => m.ContentPanel), { ssr: false });

const RIGHTPANEL_MIN = 200;
const RIGHTPANEL_MAX = 480;
const DOCPREVIEW_MIN = 320;
const DOCPREVIEW_MAX = 800;
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
  const isChatRoute = pathname.startsWith("/chat");
  const isChatDetailRoute = /^\/chat\/[^/]+/.test(pathname);

  const [assistantOpen, setAssistantOpen] = useState(false);

  // Panel state
  const [panelOpen, setPanelOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("lumos_panel_open");
    return saved !== null ? saved === "true" : true;
  });

  const [panelContent, setPanelContent] = useState<PanelContent>("files");

  const [workingDirectory, setWorkingDirectory] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("lumos_working_directory") || "";
  });

  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [pendingApprovalSessionId, setPendingApprovalSessionId] = useState("");
  const [previewFile, setPreviewFileRaw] = useState<string | null>(null);
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>("source");

  const setPreviewFile = useCallback((path: string | null) => {
    setPreviewFileRaw(path);
    if (path) setPreviewViewMode(defaultViewMode(path));
  }, []);

  // Panel width state with localStorage persistence
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 288;
    return parseInt(localStorage.getItem("lumos_rightpanel_width") || "288");
  });

  const [docPreviewWidth, setDocPreviewWidth] = useState(() => {
    if (typeof window === "undefined") return 480;
    return parseInt(localStorage.getItem("lumos_docpreview_width") || "480");
  });

  const [contentPanelWidth, setContentPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 480;
    return parseInt(localStorage.getItem("lumos_contentpanel_width") || "480");
  });

  const handleRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth((w) => Math.min(RIGHTPANEL_MAX, Math.max(RIGHTPANEL_MIN, w - delta)));
  }, []);

  const handleRightPanelResizeEnd = useCallback(() => {
    setRightPanelWidth((w) => {
      localStorage.setItem("lumos_rightpanel_width", String(w));
      return w;
    });
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

  // Close doc preview on route change
  useEffect(() => {
    setPreviewFileRaw(null);
  }, [pathname]);

  // Persist panel open state
  useEffect(() => {
    localStorage.setItem("lumos_panel_open", String(panelOpen));
  }, [panelOpen]);

  // Persist working directory
  useEffect(() => {
    if (workingDirectory) {
      localStorage.setItem("lumos_working_directory", workingDirectory);
    }
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
  }), [panelOpen, panelContent, workingDirectory, sessionId, sessionTitle, streamingSessionId, pendingApprovalSessionId, previewFile, setPreviewFile, previewViewMode]);

  return (
    <PanelContext.Provider value={panelContextValue}>
      <TooltipProvider delayDuration={300}>
        <div className="flex h-screen overflow-hidden">
          <Sidebar onOpenAssistant={openAssistant} />

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Draggable title bar region */}
            <div
              className="h-10 shrink-0"
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            />

            <TopBar onOpenAssistant={openAssistant} />

            <div className="flex flex-1 overflow-hidden">
              <main className="relative flex-1 overflow-auto">
                <ErrorBoundary>{children}</ErrorBoundary>
              </main>

              {isChatDetailRoute && (
                <>
                  <ResizeHandle side="right" onResize={handleContentPanelResize} onResizeEnd={handleContentPanelResizeEnd} />
                  <ErrorBoundary>
                    <ContentPanel width={contentPanelWidth} />
                  </ErrorBoundary>
                </>
              )}

              {isChatRoute && previewFile && (
                <ResizeHandle side="right" onResize={handleDocPreviewResize} onResizeEnd={handleDocPreviewResizeEnd} />
              )}
              {isChatRoute && previewFile && (
                <ErrorBoundary>
                  <DocPreview
                    filePath={previewFile}
                    viewMode={previewViewMode}
                    onViewModeChange={setPreviewViewMode}
                    onClose={() => setPreviewFile(null)}
                    width={docPreviewWidth}
                  />
                </ErrorBoundary>
              )}

              {isChatRoute && panelOpen && (
                <ResizeHandle side="right" onResize={handleRightPanelResize} onResizeEnd={handleRightPanelResizeEnd} />
              )}

              {isChatRoute && (
                <ErrorBoundary>
                  <RightPanel width={rightPanelWidth} />
                </ErrorBoundary>
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
  );
}

/** Lazy-load the assistant modal to keep initial bundle small */
import dynamic from "next/dynamic";

const AssistantModalLazy = dynamic(
  () =>
    import("@/components/ai-assistant/assistant-modal").then(
      (m) => m.AssistantModal
    ),
  { ssr: false, loading: () => null }
);
