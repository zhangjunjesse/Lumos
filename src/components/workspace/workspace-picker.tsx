"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderOpenIcon,
  FolderAddIcon,
  PencilEdit01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/hooks/useTranslation";

interface Workspace {
  id: string;
  name: string;
  path: string;
  is_active: number;
  file_count: number;
  status: string;
}

interface WorkspacePickerProps {
  expanded: boolean;
}

export function WorkspacePicker({ expanded }: WorkspacePickerProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const { t } = useTranslation();
  const router = useRouter();

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces");
      if (res.ok) setWorkspaces(await res.json());
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

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
        const result = await window.electronAPI.dialog.openFolder();
        if (result && !result.canceled && result.filePaths?.[0]) {
          addWorkspace(result.filePaths[0]);
        }
      } else {
        // Web fallback: prompt for path
        const path = window.prompt(t('tooltip.addFolder'));
        if (path) addWorkspace(path);
      }
    } catch {
      // silently ignore
    }
  }, [addWorkspace, t]);

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
    const newName = window.prompt(t('tooltip.editTitle'), ws.name);
    if (!newName || newName.trim() === ws.name) return;
    await fetch(`/api/workspaces/${ws.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setWorkspaces(prev => prev.map(w => w.id === ws.id ? { ...w, name: newName.trim() } : w));
  }, [t]);

  const deleteWorkspace = useCallback(async (id: string) => {
    if (!window.confirm(t('tooltip.deleteItem'))) return;
    await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    setWorkspaces(prev => prev.filter(w => w.id !== id));
  }, [t]);

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

      {workspaces.map((ws) => (
        <div key={ws.id} className="group flex items-center">
          <button
            type="button"
            className={cn(
              "flex flex-1 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent cursor-pointer",
              ws.is_active && "bg-accent font-medium"
            )}
            onClick={() => activate(ws.id)}
          >
            <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{ws.name}</span>
          </button>
          <div className="hidden group-hover:flex items-center gap-0.5 pr-1">
            <button
              type="button"
              className="rounded p-0.5 hover:bg-accent cursor-pointer"
              onClick={(e) => { e.stopPropagation(); renameWorkspace(ws); }}
            >
              <HugeiconsIcon icon={PencilEdit01Icon} className="h-3 w-3 text-muted-foreground" />
            </button>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-destructive/20 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); deleteWorkspace(ws.id); }}
            >
              <HugeiconsIcon icon={Delete02Icon} className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        </div>
      ))}

      {workspaces.length === 0 && (
        <p className="px-3 text-xs text-muted-foreground">{t('sidebar.noWorkspaces')}</p>
      )}
    </div>
  );
}
