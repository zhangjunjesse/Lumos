"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add, FolderOpen, File } from "@hugeicons/core-free-icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { useNativeFilePicker } from "@/hooks/useNativeFilePicker";
import { usePanel } from "@/hooks/usePanel";
import { cn } from "@/lib/utils";
import { openAuthUrl } from "@/lib/open-auth";
import {
  cancelDirectoryImportJob,
  clearDirectoryImportJobs,
  importDirectory,
  importFeishuDoc,
  importFeishuFile,
  importFeishuFolder,
  importLocalFile,
  importUrl,
  listDirectoryImportJobs,
  retryDirectoryImportJob,
  type KnowledgeIngestJob,
} from "@/lib/knowledge/client";

interface FeishuDocItem {
  token: string;
  title: string;
  type: string;
  url: string;
  updatedTime?: number;
  isFolder?: boolean;
  isFile?: boolean;
  fileExtension?: string;
  mimeType?: string;
}

interface LibraryImportPanelProps {
  collectionId?: string | null;
  onImported?: () => void;
  triggerClassName?: string;
}

export function LibraryImportPanel({ collectionId, onImported, triggerClassName }: LibraryImportPanelProps) {
  const { sessionId } = usePanel();
  const { openNativePicker: openFolderPicker } = useNativeFolderPicker();
  const { openNativePicker: openFilePicker } = useNativeFilePicker();

  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [activeTab, setActiveTab] = useState<"url" | "feishu">("url");
  const [ingestJobs, setIngestJobs] = useState<KnowledgeIngestJob[]>([]);

  const [urlInput, setUrlInput] = useState("");

  const [feishuAuth, setFeishuAuth] = useState<{ authenticated: boolean; loading: boolean }>({
    authenticated: false,
    loading: true,
  });
  const [feishuDriveItems, setFeishuDriveItems] = useState<FeishuDocItem[]>([]);
  const [feishuSearchResults, setFeishuSearchResults] = useState<FeishuDocItem[]>([]);
  const [feishuQuery, setFeishuQuery] = useState("");
  const [feishuDriveMode, setFeishuDriveMode] = useState<"folder" | "search">("folder");
  const [feishuDrivePageToken, setFeishuDrivePageToken] = useState<string | null>(null);
  const [feishuDriveHasMore, setFeishuDriveHasMore] = useState(false);
  const [feishuFolderStack, setFeishuFolderStack] = useState<Array<{ token: string; title: string }>>([]);
  const [selectedFeishuKeys, setSelectedFeishuKeys] = useState<string[]>([]);
  const [feishuLoading, setFeishuLoading] = useState(false);

  const refreshFeishuAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/feishu/auth/status");
      const data = await res.json();
      setFeishuAuth({ authenticated: !!data.authenticated, loading: false });
    } catch {
      setFeishuAuth({ authenticated: false, loading: false });
    }
  }, []);

  const loadFeishuSearchDocs = useCallback(async (query?: string) => {
    if (!feishuAuth.authenticated) return;
    setFeishuLoading(true);
    try {
      const q = query?.trim() || "";
      const qs = q ? `?q=${encodeURIComponent(q)}` : "";
      const res = await fetch(`/api/feishu/docs${qs}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Failed to load Feishu docs");
      }
      setFeishuSearchResults(Array.isArray(data.items) ? data.items : []);
      setFeishuDriveMode("search");
      setFeishuDriveHasMore(false);
      setFeishuDrivePageToken(null);
    } catch (error) {
      console.error("[library-import] Feishu docs load failed:", error);
      setFeishuSearchResults([]);
    } finally {
      setFeishuLoading(false);
    }
  }, [feishuAuth.authenticated]);

  const loadFeishuDriveItems = useCallback(async (options?: {
    folderToken?: string;
    pageToken?: string;
    append?: boolean;
  }) => {
    if (!feishuAuth.authenticated) return;
    setFeishuLoading(true);
    try {
      const folderToken = options?.folderToken || "";
      const qs = new URLSearchParams({
        view: "drive",
      });
      if (folderToken) qs.set("folderToken", folderToken);
      if (options?.pageToken) qs.set("pageToken", options.pageToken);
      const res = await fetch(`/api/feishu/docs?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Failed to load Feishu drive items");
      }
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setFeishuDriveItems((prev) => (options?.append ? [...prev, ...nextItems] : nextItems));
      setFeishuDriveHasMore(!!data.hasMore);
      setFeishuDrivePageToken(data.pageToken || null);
      setFeishuDriveMode("folder");
    } catch (error) {
      console.error("[library-import] Feishu drive load failed:", error);
      setFeishuDriveItems([]);
      setFeishuDriveHasMore(false);
      setFeishuDrivePageToken(null);
    } finally {
      setFeishuLoading(false);
    }
  }, [feishuAuth.authenticated]);

  const loadIngestJobs = useCallback(async () => {
    try {
      const jobs = await listDirectoryImportJobs({
        collectionId: collectionId || undefined,
        limit: 8,
      });
      setIngestJobs(jobs);
      if (jobs.some((job) => job.status === "pending" || job.status === "running")) {
        onImported?.();
      }
    } catch (error) {
      console.error("[library-import] ingest jobs load failed:", error);
      setIngestJobs([]);
    }
  }, [collectionId, onImported]);

  useEffect(() => {
    refreshFeishuAuth();
  }, [refreshFeishuAuth]);

  const currentFeishuFolderToken = feishuFolderStack.length > 0
    ? feishuFolderStack[feishuFolderStack.length - 1]?.token
    : "";

  useEffect(() => {
    if (feishuAuth.authenticated) {
      if (open && activeTab === "feishu") {
        loadFeishuDriveItems({ folderToken: currentFeishuFolderToken || "" });
      }
    } else {
      setFeishuDriveItems([]);
      setFeishuSearchResults([]);
      setFeishuDriveMode("folder");
      setFeishuDriveHasMore(false);
      setFeishuDrivePageToken(null);
    }
  }, [activeTab, feishuAuth.authenticated, currentFeishuFolderToken, loadFeishuDriveItems, open]);

  useEffect(() => {
    if (!open || activeTab !== "feishu") return;
    void loadIngestJobs();
    const timer = window.setInterval(() => {
      void loadIngestJobs();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeTab, loadIngestJobs, open]);

  const handleImportLocalFile = useCallback(async () => {
    const filePaths = await openFilePicker({ title: "选择文件", multi: true });
    if (!filePaths || filePaths.length === 0) return;
    setLoading(true);
    setStatus(null);
    try {
      let queued = 0;
      let duplicates = 0;
      for (const filePath of filePaths) {
        const result = await importLocalFile(filePath, { collectionId: collectionId || undefined });
        if (result?.duplicate) {
          duplicates += 1;
        } else {
          queued += 1;
        }
      }
      if (duplicates > 0 && queued > 0) {
        setStatus(`已加入后台队列 ${queued} 个文件，跳过重复 ${duplicates} 个`);
      } else if (duplicates > 0) {
        setStatus(`已存在 ${duplicates} 个文件，未重复添加`);
      } else {
        setStatus(`已加入后台队列 ${queued} 个文件`);
      }
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }, [collectionId, onImported, openFilePicker]);

  const handleImportDirectory = useCallback(async () => {
    const directory = await openFolderPicker({ title: "选择文件夹" });
    if (!directory) return;
    setLoading(true);
    setStatus(null);
    try {
      const result = await importDirectory({
        directory,
        collectionId: collectionId || undefined,
        recursive: true,
        baseDir: directory,
        mode: 'ingest',
      });
      const total = typeof result?.total === "number"
        ? result.total
        : (typeof result?.job?.total_files === "number" ? result.job.total_files : 0);
      const skipped = typeof result?.skipped === "number" ? result.skipped : 0;
      if (result?.queued && result?.job?.id) {
        setStatus(`已加入后台入库队列：${total} 个文件${skipped > 0 ? `，跳过 ${skipped} 个` : ""}`);
      } else {
        setStatus("目录已加入后台入库队列");
      }
      void loadIngestJobs();
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }, [collectionId, loadIngestJobs, onImported, openFolderPicker]);

  const handleRetryJob = useCallback(async (jobId: string) => {
    setLoading(true);
    setStatus(null);
    try {
      await retryDirectoryImportJob(jobId);
      setStatus("已重新排队失败项");
      await loadIngestJobs();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "重试失败");
    } finally {
      setLoading(false);
    }
  }, [loadIngestJobs]);

  const handleCancelJob = useCallback(async (jobId: string) => {
    setLoading(true);
    setStatus(null);
    try {
      await cancelDirectoryImportJob(jobId);
      setStatus("已取消该入库任务");
      await loadIngestJobs();
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "取消失败");
    } finally {
      setLoading(false);
    }
  }, [loadIngestJobs, onImported]);

  const handleClearJobs = useCallback(async () => {
    const confirmed = window.confirm("确认清空所有入库任务记录吗？正在排队/运行的任务会停止。");
    if (!confirmed) return;
    setLoading(true);
    setStatus(null);
    try {
      const result = await clearDirectoryImportJobs();
      setStatus(`已清空任务：${result.cleared_jobs} 个任务，${result.cleared_items} 个文件项`);
      await loadIngestJobs();
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "清空失败");
    } finally {
      setLoading(false);
    }
  }, [loadIngestJobs, onImported]);

  const handleReprocessDirectory = useCallback(async (job: KnowledgeIngestJob) => {
    if (job.source_type === "file") {
      setStatus("单文件任务请使用“重试失败项”");
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const result = await importDirectory({
        directory: job.source_dir,
        collectionId: collectionId || undefined,
        recursive: job.recursive !== 0,
        baseDir: job.source_dir,
        mode: 'ingest',
        forceReprocess: true,
        maxFiles: Math.max(Number(job.max_files || 0), 2000),
        maxFileSize: Number(job.max_file_size || 20 * 1024 * 1024),
      });
      const total = typeof result?.total === "number"
        ? result.total
        : (typeof result?.job?.total_files === "number" ? result.job.total_files : 0);
      setStatus(`已加入整目录重处理队列：${total} 个文件`);
      await loadIngestJobs();
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "重处理失败");
    } finally {
      setLoading(false);
    }
  }, [collectionId, loadIngestJobs, onImported]);

  const handleImportUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;
    setLoading(true);
    setStatus(null);
    try {
      const result = await importUrl(url);
      if (result?.duplicate) {
        setStatus(result?.message || "网页已存在，未重复添加");
      } else {
        setStatus("网页已加入资料库");
      }
      setUrlInput("");
      setOpen(false);
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }, [onImported, urlInput]);

  const openUrlImportDialog = useCallback(() => {
    setActiveTab("url");
    setShowJobs(false);
    setOpen(true);
  }, []);

  const openFeishuImportDialog = useCallback(() => {
    setActiveTab("feishu");
    setShowJobs(false);
    setOpen(true);
  }, []);

  const handleFeishuLogin = useCallback(async () => {
    try {
      const res = await fetch("/api/feishu/auth/login");
      const data = await res.json();
      if (data.url) {
        await openAuthUrl(data.url);
        setTimeout(() => refreshFeishuAuth(), 4000);
      }
    } catch (error) {
      console.error("[library-import] Feishu login failed:", error);
    }
  }, [refreshFeishuAuth]);

  const handleOpenFeishuFolder = useCallback((item: FeishuDocItem) => {
    if (!item.token) return;
    setFeishuFolderStack((prev) => [...prev, { token: item.token, title: item.title || "Untitled" }]);
    setFeishuDriveHasMore(false);
    setFeishuDrivePageToken(null);
    setFeishuDriveMode("folder");
  }, []);

  const handleNavigateFeishuPath = useCallback((index: number) => {
    if (index < 0) {
      setFeishuFolderStack([]);
      setFeishuDriveHasMore(false);
      setFeishuDrivePageToken(null);
      return;
    }
    setFeishuFolderStack((prev) => prev.slice(0, index + 1));
    setFeishuDriveHasMore(false);
    setFeishuDrivePageToken(null);
  }, []);

  const handleImportFeishuDoc = useCallback(async (doc: FeishuDocItem) => {
    setLoading(true);
    setStatus(null);
    try {
      const result = await importFeishuDoc({
        token: doc.token,
        type: doc.type,
        title: doc.title,
        url: doc.url,
        sessionId: sessionId || undefined,
        collectionId: collectionId || undefined,
        mode: 'full',
      });
      if (result?.duplicate) {
        setStatus(result?.message || `飞书文档已存在：${doc.title}`);
      } else {
        setStatus(`已加入后台队列：${doc.title}`);
      }
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }, [collectionId, onImported, sessionId]);

  const handleImportFeishuFile = useCallback(async (doc: FeishuDocItem) => {
    setLoading(true);
    setStatus(null);
    try {
      const extension = doc.fileExtension
        ? (doc.fileExtension.startsWith('.') ? doc.fileExtension : `.${doc.fileExtension}`)
        : '';
      const fileName = extension ? `${doc.title}${extension}` : doc.title;
      const result = await importFeishuFile({
        token: doc.token,
        title: doc.title,
        name: fileName,
        sessionId: sessionId || undefined,
        collectionId: collectionId || undefined,
      });
      if (result?.duplicate) {
        setStatus(result?.message || `飞书文件已存在：${doc.title}`);
      } else {
        setStatus(`已加入后台队列：${doc.title}`);
      }
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }, [collectionId, onImported, sessionId]);

  const handleImportFeishuFolder = useCallback(async (doc: FeishuDocItem) => {
    if (!doc.token) return;
    setLoading(true);
    setStatus(null);
    try {
      const result = await importFeishuFolder({
        token: doc.token,
        title: doc.title,
        sessionId: sessionId || undefined,
        collectionId: collectionId || undefined,
      });
      const skipped = Number(result?.skipped || 0);
      const total = Number(result?.total || 0);
      if (total > 0) {
        setStatus(`文件夹已加入索引队列：${total} 个文件${skipped > 0 ? `，跳过 ${skipped} 个` : ""}`);
      } else {
        setStatus(result?.message || `文件夹导入完成：${doc.title}`);
      }
      setShowJobs(true);
      void loadIngestJobs();
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }, [collectionId, loadIngestJobs, onImported, sessionId]);

  const openFeishuInBrowser = useCallback(async (doc: FeishuDocItem) => {
    if (!doc.url) {
      setStatus("该项目没有可打开的飞书链接");
      return;
    }
    await openAuthUrl(doc.url);
  }, []);

  const handleImportAllFeishuDocs = useCallback(async () => {
    const sourceItems = feishuDriveMode === "search"
      ? feishuSearchResults
      : feishuDriveItems.filter((doc) => !doc.isFolder && !doc.isFile);
    if (sourceItems.length === 0) return;
    setLoading(true);
    setStatus(null);
    try {
      let queued = 0;
      let duplicates = 0;
      for (const doc of sourceItems) {
        const result = await importFeishuDoc({
          token: doc.token,
          type: doc.type,
          title: doc.title,
          url: doc.url,
          sessionId: sessionId || undefined,
          collectionId: collectionId || undefined,
          mode: 'full',
        });
        if (result?.duplicate) {
          duplicates += 1;
        } else {
          queued += 1;
        }
      }
      if (duplicates > 0 && queued > 0) {
        setStatus(`已加入后台队列 ${queued} 个文档，跳过重复 ${duplicates} 个`);
      } else if (duplicates > 0) {
        setStatus(`已存在 ${duplicates} 个文档，未重复添加`);
      } else {
        setStatus(`已加入后台队列 ${queued} 个飞书文档`);
      }
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }, [collectionId, feishuDriveItems, feishuDriveMode, feishuSearchResults, onImported, sessionId]);

  const handleClearFeishuSearch = useCallback(() => {
    setFeishuDriveMode("folder");
    setFeishuSearchResults([]);
    if (feishuAuth.authenticated) {
      const folderToken = feishuFolderStack.length > 0 ? feishuFolderStack[feishuFolderStack.length - 1]?.token : "";
      loadFeishuDriveItems({ folderToken: folderToken || "" });
    }
  }, [feishuAuth.authenticated, feishuFolderStack, loadFeishuDriveItems]);

  const activeJobs = ingestJobs.filter((job) => job.status === "pending" || job.status === "running");
  const recentJobs = activeJobs.length > 0 ? activeJobs : ingestJobs.slice(0, 3);
  const hasJobs = ingestJobs.length > 0;
  const jobSummary = activeJobs.length > 0 ? `进行中 ${activeJobs.length}` : `最近 ${recentJobs.length}`;
  const isFeishuMode = activeTab === "feishu";
  const dialogClassName = isFeishuMode
    ? "w-[92vw] max-w-[1200px] sm:!max-w-[1200px] h-[84vh] max-h-[88vh] flex flex-col"
    : "w-[92vw] max-w-[640px] sm:!max-w-[640px] h-auto max-h-[88vh] flex flex-col";

  const rootLabel = "我的文件夹";
  const displayedFeishuItems = feishuDriveMode === "search" ? feishuSearchResults : feishuDriveItems;
  const sortedFeishuItems = useMemo(() => {
    return [...displayedFeishuItems].sort((a, b) => {
      const aFolder = a.isFolder ? 1 : 0;
      const bFolder = b.isFolder ? 1 : 0;
      if (aFolder !== bFolder) return bFolder - aFolder;
      return (a.title || "").localeCompare(b.title || "");
    });
  }, [displayedFeishuItems]);
  const resultCount = sortedFeishuItems.length;
  const itemKey = useCallback((doc: FeishuDocItem) => `${doc.type}:${doc.token}`, []);
  const selectedFeishuSet = useMemo(() => new Set(selectedFeishuKeys), [selectedFeishuKeys]);
  const selectedFeishuItems = useMemo(
    () => sortedFeishuItems.filter((doc) => selectedFeishuSet.has(itemKey(doc))),
    [itemKey, selectedFeishuSet, sortedFeishuItems],
  );
  const allSelectedOnPage = sortedFeishuItems.length > 0 && selectedFeishuItems.length === sortedFeishuItems.length;

  const toggleFeishuSelect = useCallback((doc: FeishuDocItem, checked: boolean) => {
    const key = itemKey(doc);
    setSelectedFeishuKeys((prev) => {
      if (checked) {
        return prev.includes(key) ? prev : [...prev, key];
      }
      return prev.filter((entry) => entry !== key);
    });
  }, [itemKey]);

  const toggleSelectAllFeishuItems = useCallback((checked: boolean) => {
    if (!checked) {
      setSelectedFeishuKeys([]);
      return;
    }
    setSelectedFeishuKeys(sortedFeishuItems.map((doc) => itemKey(doc)));
  }, [itemKey, sortedFeishuItems]);

  const handleBatchImportFeishu = useCallback(async () => {
    if (selectedFeishuItems.length === 0) return;
    setLoading(true);
    setStatus(null);

    let queued = 0;
    let duplicates = 0;
    let failed = 0;

    try {
      for (const doc of selectedFeishuItems) {
        try {
          if (doc.isFolder) {
            await importFeishuFolder({
              token: doc.token,
              title: doc.title,
              sessionId: sessionId || undefined,
              collectionId: collectionId || undefined,
            });
            queued += 1;
            continue;
          }
          if (doc.isFile) {
            const extension = doc.fileExtension
              ? (doc.fileExtension.startsWith('.') ? doc.fileExtension : `.${doc.fileExtension}`)
              : '';
            const fileName = extension ? `${doc.title}${extension}` : doc.title;
            const result = await importFeishuFile({
              token: doc.token,
              title: doc.title,
              name: fileName,
              sessionId: sessionId || undefined,
              collectionId: collectionId || undefined,
            });
            if (result?.duplicate) {
              duplicates += 1;
            } else {
              queued += 1;
            }
            continue;
          }
          const result = await importFeishuDoc({
            token: doc.token,
            type: doc.type,
            title: doc.title,
            url: doc.url,
            sessionId: sessionId || undefined,
            collectionId: collectionId || undefined,
            mode: 'full',
          });
          if (result?.duplicate) {
            duplicates += 1;
          } else {
            queued += 1;
          }
        } catch {
          failed += 1;
        }
      }
      setSelectedFeishuKeys([]);
      if (failed > 0) {
        setStatus(`批量完成：入队 ${queued}，重复 ${duplicates}，失败 ${failed}`);
      } else if (duplicates > 0) {
        setStatus(`批量完成：入队 ${queued}，重复 ${duplicates}`);
      } else {
        setStatus(`批量入队完成：${queued} 项`);
      }
      if (selectedFeishuItems.some((doc) => !!doc.isFolder)) {
        setShowJobs(true);
      }
      void loadIngestJobs();
      onImported?.();
    } finally {
      setLoading(false);
    }
  }, [collectionId, loadIngestJobs, onImported, selectedFeishuItems, sessionId]);

  useEffect(() => {
    const visible = new Set(sortedFeishuItems.map((doc) => itemKey(doc)));
    setSelectedFeishuKeys((prev) => {
      const next = prev.filter((key) => visible.has(key));
      if (next.length === prev.length && next.every((value, index) => value === prev[index])) {
        return prev;
      }
      return next;
    });
  }, [itemKey, sortedFeishuItems]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const formatFeishuTime = (value?: number) => {
    if (!value || Number.isNaN(value)) return "";
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString();
  };

  const getJobStatusLabel = (statusValue: KnowledgeIngestJob["status"]) => {
    if (statusValue === "pending") return "排队中";
    if (statusValue === "running") return "处理中";
    if (statusValue === "completed") return "已完成";
    if (statusValue === "failed") return "失败";
    return "已取消";
  };

  return (
    <div className="relative inline-flex shrink-0 items-start">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-9 rounded-lg border-border bg-background px-3 text-sm font-medium text-foreground shadow-none hover:bg-accent",
              triggerClassName,
            )}
          >
            <HugeiconsIcon icon={Add} className="h-3.5 w-3.5" />
            <span className="ml-1">添加资料</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem disabled={loading} onSelect={() => void handleImportLocalFile()}>
            导入本地文件
          </DropdownMenuItem>
          <DropdownMenuItem disabled={loading} onSelect={() => void handleImportDirectory()}>
            导入本地文件夹
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={loading} onSelect={openUrlImportDialog}>
            导入网页链接
          </DropdownMenuItem>
          <DropdownMenuItem disabled={loading} onSelect={openFeishuImportDialog}>
            导入飞书云盘
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={dialogClassName}>
          <DialogHeader className="shrink-0 pb-1">
            <div className={cn("flex flex-wrap items-start justify-between gap-3", isFeishuMode && hasJobs ? "pr-12" : "")}>
              <div>
                <DialogTitle>{isFeishuMode ? "导入飞书资料" : "导入网页"}</DialogTitle>
                <DialogDescription className="mt-1">
                  {isFeishuMode ? "从飞书云盘选择内容并导入资料库" : "粘贴网页链接后导入资料库"}
                </DialogDescription>
              </div>
              {isFeishuMode && hasJobs ? (
                <div className="mr-1 flex items-center gap-2">
                  <div className="rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
                    后台任务 · {jobSummary}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => setShowJobs((prev) => !prev)}
                  >
                    {showJobs ? "收起详情" : "查看详情"}
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogHeader>

          {activeTab === "url" ? (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="text-xs font-medium text-muted-foreground">网页链接</p>
                <Input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://..."
                  className="mt-2 h-10 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleImportUrl();
                    }
                  }}
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  支持文章页、文档页和公开网页；重复链接会自动去重。
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button size="sm" variant="ghost" className="h-9 px-3" onClick={() => setOpen(false)} disabled={loading}>
                  取消
                </Button>
                <Button size="sm" className="h-9 px-4" onClick={() => void handleImportUrl()} disabled={loading || !urlInput.trim()}>
                  导入网页
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 min-h-0 flex-col gap-2 pt-1">
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/15 px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">飞书云盘</p>
                {!feishuAuth.loading && !feishuAuth.authenticated && (
                  <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={handleFeishuLogin}>
                    登录飞书
                  </Button>
                )}
              </div>

              {feishuAuth.loading ? (
                <p className="text-xs text-muted-foreground">加载飞书状态...</p>
              ) : !feishuAuth.authenticated ? (
                <div className="rounded-lg border bg-muted/20 p-4 text-xs text-muted-foreground">
                  未登录飞书，无法读取云盘内容
                </div>
              ) : (
                <div className="flex h-full min-h-0 gap-5">
                  <div className="w-[290px] shrink-0 space-y-3">
                    <div className="rounded-lg border bg-muted/20 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-muted-foreground">我的文件夹</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => loadFeishuDriveItems({ folderToken: currentFeishuFolderToken || "" })}
                          disabled={feishuLoading}
                        >
                          刷新
                        </Button>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        支持文件夹导航、文档搜索和文件导入。
                      </p>
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-4">
                      <p className="text-[11px] font-medium text-muted-foreground">搜索文档</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">仅搜索文档类内容，不包含普通文件。</p>
                      <div className="mt-3 flex flex-col gap-2">
                        <Input
                          value={feishuQuery}
                          onChange={(e) => setFeishuQuery(e.target.value)}
                          placeholder="搜索飞书文档"
                          className="h-9 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              loadFeishuSearchDocs(feishuQuery);
                            }
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 flex-1"
                            onClick={() => loadFeishuSearchDocs(feishuQuery)}
                            disabled={feishuLoading}
                          >
                            搜索
                          </Button>
                          {feishuDriveMode === "search" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-[11px] shrink-0"
                              onClick={handleClearFeishuSearch}
                            >
                              返回文件夹
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-background overflow-hidden">
                    <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                          <button
                            type="button"
                            className="hover:text-foreground"
                            onClick={() => handleNavigateFeishuPath(-1)}
                          >
                            {rootLabel}
                          </button>
                          {feishuFolderStack.map((folder, idx) => (
                            <div key={`${folder.token}-${idx}`} className="flex items-center gap-1">
                              <span>/</span>
                              <button
                                type="button"
                                className="hover:text-foreground"
                                onClick={() => handleNavigateFeishuPath(idx)}
                              >
                                {folder.title}
                              </button>
                            </div>
                          ))}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            {feishuDriveMode === "search" ? "搜索结果" : "文件夹内容"}
                          </p>
                          <span className="text-xs text-muted-foreground">({resultCount})</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs"
                          onClick={() => void openAuthUrl(currentFeishuFolderToken
                            ? `https://feishu.cn/drive/folder/${currentFeishuFolderToken}`
                            : "https://feishu.cn/drive/home/")}
                        >
                          浏览器打开
                        </Button>
                        {feishuDriveMode === "search" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3 text-xs"
                            onClick={handleImportAllFeishuDocs}
                            disabled={loading}
                          >
                            导入全部
                          </Button>
                        )}
                        {feishuFolderStack.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-3 text-xs"
                            onClick={() => handleNavigateFeishuPath(feishuFolderStack.length - 2)}
                          >
                            返回上级
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-b px-5 py-2">
                      <div className="text-[11px] text-muted-foreground">
                        已选择 {selectedFeishuItems.length} 项
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => toggleSelectAllFeishuItems(!allSelectedOnPage)}
                        >
                          {allSelectedOnPage ? "取消全选" : "全选本页"}
                        </Button>
                        {selectedFeishuItems.length > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setSelectedFeishuKeys([])}
                          >
                            清空选择
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-3 text-[11px]"
                          onClick={handleBatchImportFeishu}
                          disabled={loading || selectedFeishuItems.length === 0}
                        >
                          批量导入{selectedFeishuItems.length > 0 ? `（${selectedFeishuItems.length}）` : ""}
                        </Button>
                      </div>
                    </div>

                    {feishuLoading ? (
                      <p className="px-4 py-4 text-xs text-muted-foreground">加载中...</p>
                    ) : sortedFeishuItems.length === 0 ? (
                      <p className="px-4 py-4 text-xs text-muted-foreground">
                        {feishuDriveMode === "search" ? "暂无搜索结果" : "此文件夹暂无内容"}
                      </p>
                    ) : (
                      <ScrollArea className="flex-1 min-h-0">
                        <div className="px-5 py-3">
                          <div className="space-y-1">
                            {sortedFeishuItems.map((doc) => {
                              const isFolder = !!doc.isFolder;
                              const isFile = !!doc.isFile;
                              const typeLabel = isFolder ? "文件夹" : isFile ? "文件" : doc.type;
                              const timeLabel = formatFeishuTime(doc.updatedTime);
                              const formatLabel = isFile
                                ? (doc.fileExtension ? doc.fileExtension.toUpperCase() : doc.mimeType)
                                : "";
                              const metaLabel = [typeLabel, formatLabel, timeLabel].filter(Boolean).join(" · ");
                              const checked = selectedFeishuSet.has(itemKey(doc));
                              return (
                                <div
                                  key={`${doc.type}:${doc.token}`}
                                  className={cn(
                                    "flex items-center justify-between gap-3 rounded-lg border px-2.5 py-2.5 transition-colors",
                                    checked
                                      ? "border-primary/35 bg-primary/[0.06]"
                                      : "border-transparent hover:border-border/70 hover:bg-muted/20",
                                  )}
                                >
                                  <div className="flex min-w-0 items-center gap-3">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(value) => toggleFeishuSelect(doc, value === true)}
                                      aria-label={`select-${doc.title}`}
                                    />
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/35">
                                      <HugeiconsIcon icon={isFolder ? FolderOpen : File} className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium leading-5">{doc.title}</p>
                                      <p className="text-[11px] text-muted-foreground leading-5">{metaLabel || "-"}</p>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-8 px-2 text-[11px]"
                                      onClick={() => void openFeishuInBrowser(doc)}
                                      disabled={loading || !doc.url}
                                    >
                                      浏览器打开
                                    </Button>
                                    {isFolder ? (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-8 px-2 text-[11px]"
                                          onClick={() => handleOpenFeishuFolder(doc)}
                                          disabled={loading}
                                        >
                                          进入
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-8 px-3 text-xs"
                                          onClick={() => void handleImportFeishuFolder(doc)}
                                          disabled={loading}
                                        >
                                          导入
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 px-3 text-xs"
                                        onClick={() => void (isFile ? handleImportFeishuFile(doc) : handleImportFeishuDoc(doc))}
                                        disabled={loading}
                                      >
                                        导入
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {feishuDriveMode === "folder" && feishuDriveHasMore && (
                            <div className="mt-3 flex justify-center">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-4 text-xs"
                                onClick={() => loadFeishuDriveItems({
                                  folderToken: currentFeishuFolderToken || "",
                                  pageToken: feishuDrivePageToken || undefined,
                                  append: true,
                                })}
                                disabled={feishuLoading || !feishuDrivePageToken}
                              >
                                加载更多
                              </Button>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {isFeishuMode && showJobs && hasJobs ? (
            <div className="mt-3 rounded-lg border border-border bg-background p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">后台入库任务</p>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => void loadIngestJobs()}
                    disabled={loading}
                  >
                    刷新
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-red-600 hover:text-red-700"
                    onClick={() => void handleClearJobs()}
                    disabled={loading}
                  >
                    清空
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {recentJobs.map((job) => {
                  const total = Math.max(0, job.total_files || 0);
                  const processed = Math.max(0, job.processed_files || 0);
                  const progress = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
                  const isReprocess = Number(job.force_reprocess || 0) === 1;
                  const isFileJob = job.source_type === "file";
                  const canRetry = (job.failed_files > 0 || job.skipped_files > 0) && job.status !== "running" && job.status !== "pending";
                  const canCancel = job.status === "pending" || job.status === "running";
                  const canReprocess = !isFileJob && job.status !== "pending" && job.status !== "running";
                  return (
                    <div key={job.id} className="rounded-md border border-border/70 bg-muted/20 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-[12px] font-medium">{job.source_dir}</p>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{getJobStatusLabel(job.status)}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{processed}/{total}</span>
                        <span>{isReprocess ? "目录重处理" : (isFileJob ? "单文件入库" : "目录入库")}</span>
                        <span>成功 {job.success_files}</span>
                        <span>重复 {job.duplicate_files}</span>
                        {(job.failed_files > 0 || job.skipped_files > 0) ? (
                          <span>异常 {job.failed_files + job.skipped_files}</span>
                        ) : null}
                        {canCancel ? (
                          <button
                            className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] hover:bg-accent"
                            onClick={() => void handleCancelJob(job.id)}
                            disabled={loading}
                          >
                            取消任务
                          </button>
                        ) : null}
                        {canRetry ? (
                          <button
                            className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] hover:bg-accent"
                            onClick={() => void handleRetryJob(job.id)}
                            disabled={loading}
                          >
                            重试失败项
                          </button>
                        ) : null}
                        {canReprocess ? (
                          <button
                            className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] hover:bg-accent"
                            onClick={() => void handleReprocessDirectory(job)}
                            disabled={loading}
                          >
                            重新处理目录
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

        </DialogContent>
      </Dialog>

      {status && (
        <div className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-max max-w-[460px] rounded-md border border-border/70 bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {status}
        </div>
      )}
    </div>
  );
}
