"use client";

import { createContext, useContext } from "react";

export type PanelContent = "files" | "tasks";

export type PreviewViewMode = "source" | "rendered";

export interface PanelContextValue {
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  contentPanelOpen: boolean;
  setContentPanelOpen: (open: boolean) => void;
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
  setPreviewFile: (path: string | null) => void;
}

export const PanelContext = createContext<PanelContextValue | null>(null);

const noop = () => {};
const noopPanel: PanelContextValue = {
  panelOpen: false,
  setPanelOpen: noop,
  contentPanelOpen: false,
  setContentPanelOpen: noop,
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
  setPreviewFile: noop,
};

export function usePanel(): PanelContextValue {
  const ctx = useContext(PanelContext);
  return ctx ?? noopPanel;
}
