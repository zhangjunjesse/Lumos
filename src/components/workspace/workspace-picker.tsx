"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderOpen,
  FolderAddIcon,
  PencilEdit01Icon,
  Delete,
  Add,
} from "@hugeicons/core-free-icons";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/hooks/useTranslation";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { FolderPicker } from "@/components/chat/FolderPicker";
import { useStreamingStore } from "@/stores/streaming-store";

interface Workspace {
  id: string;
  name: string;
  path: string;
  is_active: number;
  file_count: number;
  status: string;
}

interface ChatSession {
  id: string;
  title: string;
  folder: string;
  working_directory: string;
  updated_at: string;
}

interface WorkspacePickerProps {
  expanded: boolean;
}

export function WorkspacePicker({ expanded }: WorkspacePickerProps) {
  const pathname = usePathname();
  const streamingSessions = useStreamingStore((state) => state.sessions);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const { t } = useTranslation();
  const router = useRouter();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingWorkspace, setRenamingWorkspace] = useState<Workspace | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const fetchSessionsRequestIdRef = useRef(0);
  const optimisticDeletedSessionIdsRef = useRef<Set<string>>(new Set());
  const activeSessionId = pathname.match(/^\/chat\/([^/]+)$/)?.[1] || null;
  const activeWorkspaceId = useMemo(() => {
    if (!activeSessionId) return null;
    const activeSession = sessions.find((s) => s.id === activeSessionId);
    if (!activeSession) return null;
    const activeWorkspace = workspaces.find((w) => w.path === activeSession.working_directory);
    return activeWorkspace?.id || null;
  }, [activeSessionId, sessions, workspaces]);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces");
      if (res.ok) setWorkspaces(await res.json());
    } catch {
      // silently ignore
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    const requestId = ++fetchSessionsRequestIdRef.current;
    try {
      const res = await fetch("/api/chat/sessions", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        if (requestId !== fetchSessionsRequestIdRef.current) {
          return;
        }
        const optimisticDeletedSessionIds = optimisticDeletedSessionIdsRef.current;
        setSessions(
          (data.sessions || []).filter(
            (session: ChatSession) => !optimisticDeletedSessionIds.has(session.id),
          ),
        );
      }
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      await Promise.all([fetchWorkspaces(), fetchSessions()]);
    };
    void load();
  }, [fetchWorkspaces, fetchSessions]);

  useEffect(() => {
    const handleSessionCreated = () => {
      void fetchSessions();
    };

    const handleSessionUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; title?: string }>).detail;
      if (detail?.id) {
        setSessions((prev) =>
          prev.map((session) =>
            session.id === detail.id
              ? {
                  ...session,
                  ...(detail.title ? { title: detail.title } : {}),
                  updated_at: new Date().toISOString(),
                }
              : session,
          ),
        );
      }
      void fetchSessions();
    };

    const handleSessionDeleted = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (detail?.id) {
        optimisticDeletedSessionIdsRef.current.add(detail.id);
        setSessions((prev) => prev.filter((session) => session.id !== detail.id));
      } else {
        void fetchSessions();
      }
    };

    window.addEventListener("session-created", handleSessionCreated);
    window.addEventListener("session-updated", handleSessionUpdated);
    window.addEventListener("session-deleted", handleSessionDeleted);
    return () => {
      window.removeEventListener("session-created", handleSessionCreated);
      window.removeEventListener("session-updated", handleSessionUpdated);
      window.removeEventListener("session-deleted", handleSessionDeleted);
    };
  }, [fetchSessions]);

  useEffect(() => {
    void fetchSessions();
  }, [pathname, fetchSessions]);

  const toggleWorkspace = useCallback((id: string) => {
    setExpandedWorkspaces(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addWorkspace = useCallback(async (path: string) => {
    if (!path.trim()) return;
    await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: path.trim() }),
    });
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const openFolder = useCallback(async () => {
    try {
      if (window.electronAPI?.dialog?.openFolder) {
        const result = await window.electronAPI.dialog.openFolder() as { canceled: boolean; filePaths: string[] } | null;
        if (result && !result.canceled && result.filePaths?.[0]) {
          addWorkspace(result.filePaths[0]);
        }
      } else {
        setFolderPickerOpen(true);
      }
    } catch {
      // silently ignore
    }
  }, [addWorkspace]);

  const renameWorkspace = useCallback(async (ws: Workspace) => {
    setRenamingWorkspace(ws);
    setRenameDialogOpen(true);
  }, []);

  const handleRenameConfirm = useCallback(async (newName: string) => {
    if (!renamingWorkspace) return;
    await fetch(`/api/workspaces/${renamingWorkspace.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    setWorkspaces(prev => prev.map(w => w.id === renamingWorkspace.id ? { ...w, name: newName } : w));
    setRenamingWorkspace(null);
  }, [renamingWorkspace]);

  const deleteWorkspace = useCallback(async (id: string) => {
    if (!window.confirm(t('tooltip.deleteItem'))) return;
    await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    setWorkspaces(prev => prev.filter(w => w.id !== id));
  }, [t]);

  const handleFolderSelect = useCallback(async (path: string) => {
    addWorkspace(path);
    setFolderPickerOpen(false);
  }, [addWorkspace]);

  const createSession = useCallback(async (workspacePath: string) => {
    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: workspacePath }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/chat/${data.session.id}`);
        fetchSessions();
      }
    } catch {
      // silently ignore
    }
  }, [router, fetchSessions]);

  if (!expanded) {
    return (
      <div className="space-y-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-center rounded-md text-sm hover:bg-accent cursor-pointer"
              onClick={openFolder}
            >
              <HugeiconsIcon icon={FolderAddIcon} className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('sidebar.openFolder')}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-1">
      <div className="flex items-center justify-between px-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('sidebar.workspaces')}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={openFolder}
        >
          <HugeiconsIcon icon={FolderAddIcon} className="h-3.5 w-3.5" />
        </Button>
      </div>

      {workspaces.map((ws) => {
        const isExpanded = expandedWorkspaces.has(ws.id) || activeWorkspaceId === ws.id;
        const wsSessions = sessions.filter(s => s.working_directory === ws.path);

        return (
          <div key={ws.id} className="w-full min-w-0 space-y-0.5">
            <div className="group flex w-full min-w-0 items-center gap-1">
              <button
                type="button"
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent cursor-pointer",
                  "text-sidebar-foreground"
                )}
                onClick={() => toggleWorkspace(ws.id)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <HugeiconsIcon icon={FolderOpen} className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left">{ws.name}</span>
              </button>
              <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-accent cursor-pointer shrink-0"
                  onClick={(e) => { e.stopPropagation(); renameWorkspace(ws); }}
                >
                  <HugeiconsIcon icon={PencilEdit01Icon} className="h-3 w-3 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-destructive/20 cursor-pointer shrink-0"
                  onClick={(e) => { e.stopPropagation(); deleteWorkspace(ws.id); }}
                >
                  <HugeiconsIcon icon={Delete} className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            </div>

            {isExpanded && (
              <div className="ml-4 w-[calc(100%-1rem)] min-w-0 space-y-0.5">
                {wsSessions.map(session => (
                  (() => {
                    const streamingState = streamingSessions[session.id];
                    const isStreaming = streamingState?.status === "streaming";
                    const isUnreadCompleted = streamingState?.status === "completed";
                    const isError = streamingState?.status === "error";
                    const statusLabel = isStreaming
                      ? t('chatList.statusReplying')
                      : isUnreadCompleted
                        ? t('chatList.statusUnreadCompleted')
                        : t('chatList.statusIdle');

                    return (
                      <button
                        key={session.id}
                        type="button"
                        className={cn(
                          "flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1 text-left text-xs cursor-pointer",
                          activeSessionId === session.id
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground hover:bg-accent"
                        )}
                        onClick={() => router.push(`/chat/${session.id}`)}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            isStreaming
                              ? "bg-green-500 animate-pulse"
                              : isUnreadCompleted
                                ? "bg-blue-500"
                                : isError
                                  ? "bg-red-500"
                                  : "bg-muted-foreground/40"
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">{session.title}</span>
                        <span
                          className={cn(
                            "shrink-0 text-[10px]",
                            isStreaming
                              ? "text-green-500"
                              : isUnreadCompleted
                                ? "text-blue-500"
                                : isError
                                  ? "text-red-500"
                                  : "text-muted-foreground/60"
                          )}
                        >
                          {statusLabel}
                        </span>
                      </button>
                    );
                  })()
                ))}
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-3 py-1 text-left text-xs hover:bg-accent cursor-pointer text-muted-foreground"
                  onClick={() => createSession(ws.path)}
                >
                  <HugeiconsIcon icon={Add} className="h-3 w-3" />
                  <span>{t('chatList.newConversation')}</span>
                </button>
              </div>
            )}
          </div>
        );
      })}

      {workspaces.length === 0 && (
        <p className="px-3 text-xs text-muted-foreground">{t('sidebar.noWorkspaces')}</p>
      )}

      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title={t('tooltip.editTitle')}
        label={t('sidebar.workspaceName')}
        defaultValue={renamingWorkspace?.name || ""}
        onConfirm={handleRenameConfirm}
      />

      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleFolderSelect}
      />
    </div>
  );
}
