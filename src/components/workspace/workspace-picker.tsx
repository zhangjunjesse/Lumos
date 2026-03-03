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
import { RenameDialog } from "@/components/ui/rename-dialog";

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
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingWorkspace, setRenamingWorkspace] = useState<Workspace | null>(null);

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
        const result = await window.electronAPI.dialog.openFolder() as { canceled: boolean; filePaths: string[] } | null;
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
        <div key={ws.id} className="group grid grid-cols-[1fr_auto] items-center gap-1 pr-1">
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent cursor-pointer min-w-0",
              ws.is_active && "bg-accent font-medium"
            )}
            onClick={() => activate(ws.id)}
          >
            <HugeiconsIcon icon={FolderOpenIcon} className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{ws.name}</span>
          </button>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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

      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title={t('tooltip.editTitle')}
        label={t('sidebar.workspaceName')}
        defaultValue={renamingWorkspace?.name || ""}
        onConfirm={handleRenameConfirm}
      />
    </div>
  );
}
