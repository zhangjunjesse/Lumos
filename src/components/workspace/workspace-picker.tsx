"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderOpen,
  FolderAddIcon,
  PencilEdit01Icon,
  Delete,
  ArrowRight,
  ArrowDown01,
  Folder,
  Add,
} from "@hugeicons/core-free-icons";
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
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const { t } = useTranslation();
  const router = useRouter();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingWorkspace, setRenamingWorkspace] = useState<Workspace | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces");
      if (res.ok) setWorkspaces(await res.json());
    } catch {
      // silently ignore
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
    fetchSessions();
  }, [fetchWorkspaces, fetchSessions]);

  const toggleWorkspace = useCallback((id: string) => {
    setExpandedWorkspaces(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFolder = useCallback((key: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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

  const activate = useCallback(
    async (id: string) => {
      await fetch(`/api/workspaces/${id}/activate`, { method: "POST" });
      setWorkspaces(prev => prev.map(ws => ({ ...ws, is_active: ws.id === id ? 1 : 0 })));
      const ws = workspaces.find(w => w.id === id);
      if (ws?.path) {
        localStorage.setItem('codepilot:last-working-directory', ws.path);
      }
      // Navigate to the most recent session for this workspace, or new chat
      try {
        const res = await fetch("/api/chat/sessions");
        if (res.ok) {
          const { sessions } = await res.json();
          const match = sessions.find((s: { working_directory: string }) => s.working_directory === ws?.path);
          if (match) {
            router.push(`/chat/${match.id}`);
            return;
          }
        }
      } catch {
        // fall through to default
      }
      router.push("/chat");
    },
    [workspaces, router]
  );

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
    <div className="space-y-1">
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
        const isExpanded = expandedWorkspaces.has(ws.id);
        const wsSessions = sessions.filter(s => s.working_directory === ws.path);

        return (
          <div key={ws.id} className="space-y-0.5">
            <div className="group flex items-center gap-1 px-1">
              <button
                type="button"
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent cursor-pointer flex-1 min-w-0",
                  ws.is_active && "bg-accent font-medium"
                )}
                onClick={() => toggleWorkspace(ws.id)}
              >
                <HugeiconsIcon icon={isExpanded ? ArrowDown01 : ArrowRight} className="h-3 w-3 shrink-0" />
                <HugeiconsIcon icon={FolderOpen} className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{ws.name}</span>
              </button>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-[52px]">
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
              <div className="ml-4 space-y-0.5">
                {wsSessions.map(session => (
                  <button
                    key={session.id}
                    type="button"
                    className="flex items-center gap-2 rounded-md px-3 py-1 text-xs hover:bg-accent cursor-pointer w-full truncate"
                    onClick={() => router.push(`/chat/${session.id}`)}
                  >
                    <span className="truncate">{session.title}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md px-3 py-1 text-xs hover:bg-accent cursor-pointer w-full text-muted-foreground"
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
