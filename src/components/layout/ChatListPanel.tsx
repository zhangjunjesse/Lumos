"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add,
  ArrowDown01,
  ArrowRight,
  Delete,
  Download,
  Folder,
  FolderOpen,
  Globe,
  Notification,
  PencilEdit01Icon,
  Search,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, parseDBDate } from "@/lib/utils";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { ConnectionStatus } from "./ConnectionStatus";
import { ImportSessionDialog } from "./ImportSessionDialog";
import { FolderPicker } from "@/components/chat/FolderPicker";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { CreateFolderDialog } from "@/components/ui/create-folder-dialog";
import { useStreamingStore } from "@/stores/streaming-store";
import type { ChatSession } from "@/types";
import { getSessionEntryBasePath, getSessionEntryFromPath } from "@/lib/chat/session-entry";

interface ChatListPanelProps {
  open: boolean;
  width?: number;
}

function formatRelativeTime(
  dateStr: string,
  t: (key: import("@/i18n").TranslationKey, params?: Record<string, string | number>) => string,
): string {
  const date = parseDBDate(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return t("chatList.justNow");
  if (diffMin < 60) return t("chatList.minutesAgo", { n: diffMin });
  if (diffHr < 24) return t("chatList.hoursAgo", { n: diffHr });
  if (diffDay < 7) return t("chatList.daysAgo", { n: diffDay });
  return date.toLocaleDateString();
}

const COLLAPSED_PROJECTS_KEY = "codepilot:collapsed-projects";
const COLLAPSED_FOLDERS_KEY = "codepilot:collapsed-folders";
const COLLAPSED_INITIALIZED_KEY = "codepilot:collapsed-initialized";

function loadCollapsedProjects(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSED_PROJECTS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore
  }
  return new Set();
}

function saveCollapsedProjects(collapsed: Set<string>) {
  localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...collapsed]));
}

function loadCollapsedFolders(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSED_FOLDERS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore
  }
  return new Set();
}

function saveCollapsedFolders(collapsed: Set<string>) {
  localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...collapsed]));
}

interface FolderGroup {
  folder: string;
  sessions: ChatSession[];
}

interface ProjectGroup {
  workingDirectory: string;
  displayName: string;
  folders: FolderGroup[];
  createdAt: number;
}

function groupSessionsByProject(sessions: ChatSession[]): ProjectGroup[] {
  const projectMap = new Map<string, Map<string, ChatSession[]>>();

  for (const session of sessions) {
    const projectKey = session.working_directory || "";
    const folderKey = session.folder || "";

    if (!projectMap.has(projectKey)) {
      projectMap.set(projectKey, new Map());
    }
    const folderMap = projectMap.get(projectKey)!;
    if (!folderMap.has(folderKey)) {
      folderMap.set(folderKey, []);
    }
    folderMap.get(folderKey)!.push(session);
  }

  const groups: ProjectGroup[] = [];
  for (const [workingDirectory, folderMap] of projectMap) {
    const folders: FolderGroup[] = [];

    for (const [folder, folderSessions] of folderMap) {
      folderSessions.sort(
        (a, b) => parseDBDate(b.updated_at).getTime() - parseDBDate(a.updated_at).getTime(),
      );

      folders.push({
        folder,
        sessions: folderSessions,
      });
    }

    folders.sort((a, b) => a.folder.localeCompare(b.folder));
    const allSessions = Array.from(folderMap.values()).flat();
    const displayName = workingDirectory
      ? allSessions[0]?.project_name || workingDirectory.split("/").pop() || workingDirectory
      : "";
    const createdAt = Math.min(
      ...allSessions.map((session) => parseDBDate(session.created_at).getTime()),
    );

    groups.push({
      workingDirectory,
      displayName,
      folders,
      createdAt,
    });
  }

  groups.sort((a, b) => b.createdAt - a.createdAt);
  return groups;
}

const MODE_BADGE_CONFIG = {
  code: { className: "bg-blue-500/10 text-blue-500" },
  plan: { className: "bg-sky-500/10 text-sky-500" },
} as const;

export function ChatListPanel({ open, width }: ChatListPanelProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { pendingApprovalSessionId, workingDirectory } = usePanel();
  const { t } = useTranslation();
  const { isElectron, openNativePicker } = useNativeFolderPicker();
  const streamingSessions = useStreamingStore((state) => state.sessions);
  const sessionEntry = getSessionEntryFromPath(pathname);
  const sessionBasePath = getSessionEntryBasePath(sessionEntry);
  const isMainAgentEntry = sessionEntry === "main-agent";
  const activeSessionId = useMemo(() => {
    const prefix = `${sessionBasePath}/`;
    return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
  }, [pathname, sessionBasePath]);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => loadCollapsedProjects(),
  );
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => loadCollapsedFolders(),
  );
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamingSession, setRenamingSession] = useState<ChatSession | null>(null);
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [creatingFolderForProject, setCreatingFolderForProject] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/sessions?entry=${sessionEntry}`);
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      // API may not be available yet
    }
  }, [sessionEntry]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    fetchSessions();
  }, [pathname, fetchSessions]);

  useEffect(() => {
    const handler = () => fetchSessions();
    window.addEventListener("session-created", handler);
    window.addEventListener("session-updated", handler);
    window.addEventListener("session-deleted", handler);
    return () => {
      window.removeEventListener("session-created", handler);
      window.removeEventListener("session-updated", handler);
      window.removeEventListener("session-deleted", handler);
    };
  }, [fetchSessions]);

  const handleFolderSelect = useCallback(async (path: string) => {
    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: path, entry: sessionEntry }),
      });
      if (!res.ok) return;
      const data = await res.json();
      window.dispatchEvent(new CustomEvent("session-created"));
      router.push(`${sessionBasePath}/${data.session.id}`);
    } catch {
      // Silently fail
    }
  }, [router, sessionBasePath, sessionEntry]);

  const openFolderPicker = useCallback(async (defaultPath?: string) => {
    if (isElectron) {
      const path = await openNativePicker({ defaultPath, title: t("folderPicker.title") });
      if (path) handleFolderSelect(path);
      return;
    }
    setFolderPickerOpen(true);
  }, [handleFolderSelect, isElectron, openNativePicker, t]);

  const handleNewChat = useCallback(async () => {
    if (isMainAgentEntry) {
      setCreatingChat(true);
      try {
        const res = await fetch("/api/chat/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entry: "main-agent",
            model: localStorage.getItem("codepilot:last-model") || "",
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        router.push(`/main-agent/${data.session.id}`);
        window.dispatchEvent(new CustomEvent("session-created"));
      } catch {
        // Silently fail
      } finally {
        setCreatingChat(false);
      }
      return;
    }

    const lastDir = workingDirectory
      || (typeof window !== "undefined" ? localStorage.getItem("codepilot:last-working-directory") : null);

    if (!lastDir) {
      openFolderPicker();
      return;
    }

    setCreatingChat(true);
    try {
      const checkRes = await fetch(`/api/files/browse?dir=${encodeURIComponent(lastDir)}`);
      if (!checkRes.ok) {
        localStorage.removeItem("codepilot:last-working-directory");
        openFolderPicker();
        return;
      }

      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          working_directory: lastDir,
          model: localStorage.getItem("codepilot:last-model") || "",
          entry: sessionEntry,
        }),
      });
      if (!res.ok) {
        localStorage.removeItem("codepilot:last-working-directory");
        openFolderPicker();
        return;
      }

      const data = await res.json();
      router.push(`${sessionBasePath}/${data.session.id}`);
      window.dispatchEvent(new CustomEvent("session-created"));
    } catch {
      openFolderPicker();
    } finally {
      setCreatingChat(false);
    }
  }, [isMainAgentEntry, openFolderPicker, router, sessionBasePath, sessionEntry, workingDirectory]);

  const toggleProject = useCallback((workingDirectory: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(workingDirectory)) next.delete(workingDirectory);
      else next.add(workingDirectory);
      saveCollapsedProjects(next);
      return next;
    });
  }, []);

  const toggleFolder = useCallback((folderKey: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      saveCollapsedFolders(next);
      return next;
    });
  }, []);

  const handleDeleteSession = async (
    e: React.MouseEvent,
    sessionId: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t("chatList.deleteConversationConfirm"))) return;

    setDeletingSession(sessionId);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) return;

      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
      window.dispatchEvent(new CustomEvent("session-deleted", { detail: { id: sessionId } }));
      if (pathname === `${sessionBasePath}/${sessionId}`) {
        router.push(sessionBasePath);
      }
    } catch {
      // Silently fail
    } finally {
      setDeletingSession(null);
    }
  };

  const handleRenameSession = async (
    e: React.MouseEvent,
    session: ChatSession,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setRenamingSession(session);
    setRenameDialogOpen(true);
  };

  const handleRenameConfirm = useCallback(async (newTitle: string) => {
    if (!renamingSession) return;

    try {
      const res = await fetch(`/api/chat/sessions/${renamingSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      if (!res.ok) return;

      setSessions((prev) =>
        prev.map((session) =>
          session.id === renamingSession.id ? { ...session, title: newTitle } : session,
        ),
      );
      window.dispatchEvent(new CustomEvent("session-updated", {
        detail: { id: renamingSession.id, title: newTitle },
      }));
    } catch {
      // Silently fail
    } finally {
      setRenamingSession(null);
    }
  }, [renamingSession]);

  const handleCreateFolder = useCallback(async (projectPath: string) => {
    if (isElectron) {
      const path = await openNativePicker({
        defaultPath: projectPath,
        title: "Select folder for new session",
      });
      if (!path) return;

      try {
        const res = await fetch("/api/chat/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            working_directory: path,
            model: localStorage.getItem("codepilot:last-model") || "",
            entry: sessionEntry,
          }),
        });
        if (!res.ok) return;

        const data = await res.json();
        window.dispatchEvent(new CustomEvent("session-created"));
        router.push(`${sessionBasePath}/${data.session.id}`);
      } catch {
        // Silently fail
      }
      return;
    }

    setCreatingFolderForProject(projectPath);
    setCreateFolderDialogOpen(true);
  }, [isElectron, openNativePicker, router, sessionBasePath, sessionEntry]);

  const handleCreateFolderConfirm = useCallback(async (folderName: string) => {
    if (!creatingFolderForProject) return;

    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          working_directory: creatingFolderForProject,
          folder: folderName,
          model: localStorage.getItem("codepilot:last-model") || "",
          entry: sessionEntry,
        }),
      });
      if (!res.ok) return;

      const data = await res.json();
      window.dispatchEvent(new CustomEvent("session-created"));
      router.push(`${sessionBasePath}/${data.session.id}`);
    } catch {
      // Silently fail
    } finally {
      setCreatingFolderForProject(null);
    }
  }, [creatingFolderForProject, router, sessionBasePath, sessionEntry]);

  const handleCreateSessionInFolder = async (
    e: React.MouseEvent,
    workingDirectory: string,
    folder: string,
  ) => {
    e.stopPropagation();
    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          working_directory: workingDirectory,
          folder,
          model: localStorage.getItem("codepilot:last-model") || "",
          entry: sessionEntry,
        }),
      });
      if (!res.ok) return;

      const data = await res.json();
      window.dispatchEvent(new CustomEvent("session-created"));
      router.push(`${sessionBasePath}/${data.session.id}`);
    } catch {
      // Silently fail
    }
  };

  const isSearching = searchQuery.length > 0;
  const filteredSessions = searchQuery
    ? sessions.filter(
        (session) =>
          session.title.toLowerCase().includes(searchQuery.toLowerCase())
          || (session.project_name && session.project_name.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    : sessions;
  const projectGroups = useMemo(
    () => groupSessionsByProject(filteredSessions),
    [filteredSessions],
  );

  useEffect(() => {
    if (projectGroups.length <= 1) return;
    if (isMainAgentEntry) return;
    if (localStorage.getItem(COLLAPSED_INITIALIZED_KEY)) return;

    const toCollapse = new Set(projectGroups.slice(1).map((group) => group.workingDirectory));
    setCollapsedProjects(toCollapse);
    saveCollapsedProjects(toCollapse);
    localStorage.setItem(COLLAPSED_INITIALIZED_KEY, "1");
  }, [isMainAgentEntry, projectGroups]);

  if (!open) return null;

  return (
    <aside
      className="flex h-full shrink-0 flex-col overflow-hidden bg-sidebar"
      style={{ width: width ?? 240 }}
    >
      <div className="mt-10 flex h-12 shrink-0 items-center justify-between px-3 pl-6">
        <span className="text-[13px] font-semibold tracking-tight text-sidebar-foreground">
          {t("chatList.threads")}
        </span>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7"
                onClick={() => router.push("/browser")}
              >
                <HugeiconsIcon icon={Globe} className="h-4 w-4" />
                <span className="sr-only">{t("chatList.openBrowser")}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("chatList.openBrowser")}</TooltipContent>
          </Tooltip>
          <ConnectionStatus />
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 flex-1 justify-center gap-1.5 text-xs"
          disabled={creatingChat}
          onClick={handleNewChat}
        >
          <HugeiconsIcon icon={Add} className="h-3.5 w-3.5" />
          {t("chatList.newConversation")}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className="h-8 w-8 shrink-0"
              onClick={() => openFolderPicker()}
            >
              <HugeiconsIcon icon={FolderOpen} className="h-3.5 w-3.5" />
              <span className="sr-only">{t("chatList.addProjectFolder")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("chatList.addProjectFolder")}</TooltipContent>
        </Tooltip>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <HugeiconsIcon
            icon={Search}
            className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder={t("chatList.searchSessions")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="px-3 pb-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setImportDialogOpen(true)}
        >
          <HugeiconsIcon icon={Download} className="h-3 w-3" />
          {t("chatList.importFromCli")}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3">
        <div className="flex flex-col pb-3">
          {filteredSessions.length === 0 ? (
            <p className="px-2.5 py-3 text-[11px] text-muted-foreground/60">
              {searchQuery ? t("chatList.noMatchingSessions") : t("chatList.noSessions")}
            </p>
          ) : (
            projectGroups.map((group) => {
              const projectKey = group.workingDirectory || "__no_project";
              const projectLabel = group.workingDirectory === ""
                ? t("chatList.noProject")
                : group.displayName;
              const projectCollapsed = !isMainAgentEntry
                && !isSearching
                && collapsedProjects.has(group.workingDirectory);
              const showProjectHeader = !isMainAgentEntry || group.workingDirectory !== "";

              return (
                <div key={projectKey} className="mt-1 first:mt-0">
                  {showProjectHeader && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "flex cursor-pointer select-none items-center gap-1 rounded-md px-2 py-1 transition-colors",
                            "hover:bg-accent/50",
                          )}
                          onClick={() => {
                            if (!isMainAgentEntry) toggleProject(group.workingDirectory);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (!group.workingDirectory) return;
                            if (window.electronAPI?.shell?.openPath) {
                              window.electronAPI.shell.openPath(group.workingDirectory);
                              return;
                            }
                            fetch("/api/files/open", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ path: group.workingDirectory }),
                            }).catch(() => {});
                          }}
                          onMouseEnter={() => setHoveredProject(group.workingDirectory)}
                          onMouseLeave={() => setHoveredProject(null)}
                        >
                          <HugeiconsIcon
                            icon={projectCollapsed ? ArrowRight : ArrowDown01}
                            className="h-3 w-3 shrink-0 text-muted-foreground"
                          />
                          <HugeiconsIcon
                            icon={projectCollapsed ? Folder : FolderOpen}
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                          />
                          <span className="flex-1 truncate text-[12px] font-medium text-sidebar-foreground">
                            {projectLabel}
                          </span>
                          {group.workingDirectory !== "" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className={cn(
                                    "h-5 w-5 shrink-0 text-muted-foreground transition-opacity hover:text-foreground",
                                    hoveredProject === group.workingDirectory
                                      ? "opacity-100"
                                      : "pointer-events-none opacity-0",
                                  )}
                                  tabIndex={hoveredProject === group.workingDirectory ? 0 : -1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCreateFolder(group.workingDirectory);
                                  }}
                                >
                                  <HugeiconsIcon icon={Add} className="h-3 w-3" />
                                  <span className="sr-only">
                                    {t("chatList.newChatInProject", { name: projectLabel })}
                                  </span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                {t("chatList.newChatInProject", { name: projectLabel })}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="break-all text-xs">
                          {group.workingDirectory || t("chatList.noProject")}
                        </p>
                        {group.workingDirectory && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {t("chatList.doubleClickToOpenFolder")}
                          </p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {!projectCollapsed && (
                    <div className={cn("mt-0.5 flex flex-col gap-0.5", isMainAgentEntry && !showProjectHeader && "mt-0")}>
                      {group.folders.map((folderGroup) => {
                        const folderKey = `${group.workingDirectory}:${folderGroup.folder}`;
                        const folderCollapsed = !isSearching && collapsedFolders.has(folderKey);
                        const folderLabel = folderGroup.folder || "Default";

                        return (
                          <div key={folderKey}>
                            <div
                              className={cn(
                                "flex cursor-pointer select-none items-center gap-1 rounded-md py-1 pr-2 transition-colors hover:bg-accent/50",
                                showProjectHeader ? "pl-5" : "pl-2.5",
                              )}
                              onClick={() => toggleFolder(folderKey)}
                              onMouseEnter={() => setHoveredFolder(folderKey)}
                              onMouseLeave={() => setHoveredFolder(null)}
                            >
                              <HugeiconsIcon
                                icon={folderCollapsed ? ArrowRight : ArrowDown01}
                                className="h-3 w-3 shrink-0 text-muted-foreground"
                              />
                              <HugeiconsIcon
                                icon={folderCollapsed ? Folder : FolderOpen}
                                className="h-3 w-3 shrink-0 text-muted-foreground"
                              />
                              <span className="flex-1 truncate text-[11px] text-sidebar-foreground">
                                {folderLabel}
                              </span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className={cn(
                                      "h-5 w-5 shrink-0 text-muted-foreground transition-opacity hover:text-foreground",
                                      hoveredFolder === folderKey
                                        ? "opacity-100"
                                        : "pointer-events-none opacity-0",
                                    )}
                                    tabIndex={hoveredFolder === folderKey ? 0 : -1}
                                    onClick={(e) => handleCreateSessionInFolder(
                                      e,
                                      group.workingDirectory,
                                      folderGroup.folder,
                                    )}
                                  >
                                    <HugeiconsIcon icon={Add} className="h-3 w-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                  {t("chatList.newChatInProject", { name: folderLabel })}
                                </TooltipContent>
                              </Tooltip>
                            </div>

                            {!folderCollapsed && (
                              <div className="flex flex-col gap-0.5">
                                {folderGroup.sessions.map((session) => {
                                  const isActive = activeSessionId === session.id;
                                  const isHovered = hoveredSession === session.id;
                                  const isDeleting = deletingSession === session.id;
                                  const streamingState = streamingSessions[session.id];
                                  const isSessionStreaming = streamingState?.status === "streaming";
                                  const isSessionCompletedUnread = streamingState?.status === "completed";
                                  const isSessionError = streamingState?.status === "error";
                                  const statusLabel = isSessionStreaming
                                    ? t("chatList.statusReplying")
                                    : isSessionCompletedUnread
                                      ? t("chatList.statusUnreadCompleted")
                                      : t("chatList.statusIdle");
                                  const needsApproval = pendingApprovalSessionId === session.id;
                                  const mode = session.mode || "code";
                                  const badgeCfg = MODE_BADGE_CONFIG[mode as keyof typeof MODE_BADGE_CONFIG] || MODE_BADGE_CONFIG.code;
                                  const badgeLabel = mode === "plan"
                                    ? t("messageInput.modePlan")
                                    : t("messageInput.modeCode");

                                  return (
                                    <div
                                      key={session.id}
                                      className="group relative"
                                      onMouseEnter={() => setHoveredSession(session.id)}
                                      onMouseLeave={() => setHoveredSession(null)}
                                    >
                                      <Link
                                        href={`${sessionBasePath}/${session.id}`}
                                        className={cn(
                                          "flex min-w-0 items-center gap-1.5 rounded-md py-1.5 transition-all duration-150",
                                          showProjectHeader ? "pl-7" : "pl-5",
                                          isHovered ? "pr-16" : "pr-2",
                                          isActive
                                            ? "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-border/60"
                                            : "text-sidebar-foreground hover:bg-accent/50",
                                        )}
                                      >
                                        {isSessionStreaming ? (
                                          <span className="relative flex h-2 w-2 shrink-0">
                                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                                            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                                          </span>
                                        ) : (
                                          <span className="flex h-2 w-2 shrink-0 items-center justify-center">
                                            <span
                                              className={cn(
                                                "h-1.5 w-1.5 rounded-full",
                                                isSessionCompletedUnread
                                                  ? "bg-blue-500"
                                                  : isSessionError
                                                    ? "bg-red-500"
                                                    : "bg-muted-foreground/30",
                                              )}
                                            />
                                          </span>
                                        )}
                                        {needsApproval && (
                                          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
                                            <HugeiconsIcon
                                              icon={Notification}
                                              className="h-2.5 w-2.5 text-amber-500"
                                            />
                                          </span>
                                        )}
                                        <div className="min-w-0 flex-1 overflow-hidden">
                                          <span className="block truncate text-[12px] font-medium leading-tight">
                                            {session.title}
                                          </span>
                                          {streamingState?.content && (
                                            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/60">
                                              {streamingState.content.slice(-80)}
                                            </span>
                                          )}
                                        </div>
                                        {!isHovered && (
                                          <div className="flex shrink-0 items-center gap-1.5">
                                            <span
                                              className={cn(
                                                "text-[9px] font-medium leading-none",
                                                isSessionStreaming
                                                  ? "text-green-500"
                                                  : isSessionCompletedUnread
                                                    ? "text-blue-500"
                                                    : "text-muted-foreground/70",
                                              )}
                                            >
                                              {statusLabel}
                                            </span>
                                            <span
                                              className={cn(
                                                "rounded px-1 py-0.5 text-[9px] font-medium leading-none",
                                                badgeCfg.className,
                                              )}
                                            >
                                              {badgeLabel}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground/40">
                                              {formatRelativeTime(session.updated_at, t)}
                                            </span>
                                          </div>
                                        )}
                                      </Link>
                                      {(isHovered || isDeleting) && (
                                        <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded-md bg-sidebar px-0.5">
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                className="h-5 w-5 text-muted-foreground/60 hover:text-foreground"
                                                onClick={(e) => handleRenameSession(e, session)}
                                              >
                                                <HugeiconsIcon icon={PencilEdit01Icon} className="h-3 w-3" />
                                                <span className="sr-only">{t("tooltip.editTitle")}</span>
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="right">{t("tooltip.editTitle")}</TooltipContent>
                                          </Tooltip>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                className="h-5 w-5 text-muted-foreground/60 hover:text-destructive"
                                                onClick={(e) => handleDeleteSession(e, session.id)}
                                                disabled={isDeleting}
                                              >
                                                <HugeiconsIcon icon={Delete} className="h-3 w-3" />
                                                <span className="sr-only">{t("chatList.delete")}</span>
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="right">{t("chatList.delete")}</TooltipContent>
                                          </Tooltip>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 px-3 py-2 text-center">
        <span className="text-[10px] text-muted-foreground/40">
          v{process.env.NEXT_PUBLIC_APP_VERSION}
        </span>
      </div>

      <ImportSessionDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />

      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleFolderSelect}
      />

      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title={t("tooltip.editTitle")}
        label={t("chatList.sessionName")}
        defaultValue={renamingSession?.title || ""}
        onConfirm={handleRenameConfirm}
      />

      <CreateFolderDialog
        open={createFolderDialogOpen}
        onOpenChange={setCreateFolderDialogOpen}
        onConfirm={handleCreateFolderConfirm}
      />
    </aside>
  );
}
