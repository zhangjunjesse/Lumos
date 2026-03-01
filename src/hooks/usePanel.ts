"use client";

import { createContext, useContext } from "react";

export type PanelContent = "files" | "tasks";

export type PreviewViewMode = "source" | "rendered";

export interface PanelContextValue {
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  panelContent: PanelContent;
  setPanelContent: (content: PanelContent) => void;
  workingDirectory: string;
  setWorkingDirectory: (dir: string) => void;
  sessionId: string;
  setSessionId: (id: string) => void;
  sessionTitle: string;
  setSessionTitle: (title: string) => void;
  streamingSessionId: string;
  setStreamingSessionId: (id: string) => void;
  pendingApprovalSessionId: string;
  setPendingApprovalSessionId: (id: string) => void;
  previewFile: string | null;
  setPreviewFile: (path: string | null) => void;
  previewViewMode: PreviewViewMode;
  setPreviewViewMode: (mode: PreviewViewMode) => void;
}

export const PanelContext = createContext<PanelContextValue | null>(null);

const noop = () => {};
const noopPanel: PanelContextValue = {
  panelOpen: false,
  setPanelOpen: noop,
  panelContent: "files",
  setPanelContent: noop,
  workingDirectory: "",
  setWorkingDirectory: noop,
  sessionId: "",
  setSessionId: noop,
  sessionTitle: "",
  setSessionTitle: noop,
  streamingSessionId: "",
  setStreamingSessionId: noop,
  pendingApprovalSessionId: "",
  setPendingApprovalSessionId: noop,
  previewFile: null,
  setPreviewFile: noop,
  previewViewMode: "source",
  setPreviewViewMode: noop,
};

export function usePanel(): PanelContextValue {
  const ctx = useContext(PanelContext);
  return ctx ?? noopPanel;
}
