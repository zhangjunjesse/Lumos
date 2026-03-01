"use client";

import { useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { RightPanel } from "./RightPanel";
import { ResizeHandle } from "./ResizeHandle";
import { ErrorBoundary } from "./ErrorBoundary";
import { PanelContext, type PanelContent, type PreviewViewMode } from "@/hooks/usePanel";

const RIGHTPANEL_MIN = 200;
const RIGHTPANEL_MAX = 480;

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const isChatRoute = pathname.startsWith("/chat");

  const [assistantOpen, setAssistantOpen] = useState(false);

  // Panel state
  const [panelOpen, setPanelOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("codepilot_panel_open");
    return saved !== null ? saved === "true" : true;
  });

  const [panelContent, setPanelContent] = useState<PanelContent>("files");

  const [workingDirectory, setWorkingDirectory] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("codepilot_working_directory") || "";
  });

  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [pendingApprovalSessionId, setPendingApprovalSessionId] = useState("");
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewViewMode, setPreviewViewMode] = useState<PreviewViewMode>("source");

  // Panel width state with localStorage persistence
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 288;
    return parseInt(localStorage.getItem("codepilot_rightpanel_width") || "288");
  });

  const handleRightPanelResize = useCallback((delta: number) => {
    setRightPanelWidth((w) => Math.min(RIGHTPANEL_MAX, Math.max(RIGHTPANEL_MIN, w - delta)));
  }, []);

  const handleRightPanelResizeEnd = useCallback(() => {
    setRightPanelWidth((w) => {
      localStorage.setItem("codepilot_rightpanel_width", String(w));
      return w;
    });
  }, []);

  // Persist panel open state
  useEffect(() => {
    localStorage.setItem("codepilot_panel_open", String(panelOpen));
  }, [panelOpen]);

  // Persist working directory
  useEffect(() => {
    if (workingDirectory) {
      localStorage.setItem("codepilot_working_directory", workingDirectory);
    }
  }, [workingDirectory]);

  const openAssistant = useCallback(() => {
    setAssistantOpen(true);
  }, []);

  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
  }, []);

  const panelContextValue = {
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
  };

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
