"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add, FolderOpen, File } from "@hugeicons/core-free-icons";
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
  const { sessionId, workingDirectory } = usePanel();
  const { openNativePicker: openFolderPicker } = useNativeFolderPicker();
  const { openNativePicker: openFilePicker } = useNativeFilePicker();

  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("local");
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
  const [feishuDriveScope, setFeishuDriveScope] = useState<"my" | "shared">("my");
  const [feishuFolderStack, setFeishuFolderStack] = useState<Array<{ token: string; title: string }>>([]);
  const [feishuSharedFolderInput, setFeishuSharedFolderInput] = useState("");
  const [feishuSharedRootToken, setFeishuSharedRootToken] = useState("");
  const [feishuSharedNeedsToken, setFeishuSharedNeedsToken] = useState(false);
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
      setFeishuSharedNeedsToken(false);
    } catch (error) {
      console.error("[library-import] Feishu docs load failed:", error);
      setFeishuSearchResults([]);
    } finally {
      setFeishuLoading(false);
    }
  }, [feishuAuth.authenticated]);

  const extractFolderToken = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return "";
    const match = trimmed.match(/folder\/([a-zA-Z0-9_-]+)/i);
    if (match?.[1]) return match[1];
    return trimmed.split("?")[0] || trimmed;
  }, []);

  const loadFeishuDriveItems = useCallback(async (options?: { scope?: "my" | "shared"; folderToken?: string }) => {
    if (!feishuAuth.authenticated) return;
    setFeishuLoading(true);
    try {
      const scope = options?.scope || feishuDriveScope;
      const folderToken = options?.folderToken || "";
      const qs = new URLSearchParams({
        view: "drive",
        scope,
      });
      if (folderToken) qs.set("folderToken", folderToken);
      const res = await fetch(`/api/feishu/docs?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Failed to load Feishu drive items");
      }
      setFeishuDriveItems(Array.isArray(data.items) ? data.items : []);
      setFeishuSharedNeedsToken(!!data.needsSharedFolder);
      setFeishuDriveMode("folder");
    } catch (error) {
      console.error("[library-import] Feishu drive load failed:", error);
      setFeishuDriveItems([]);
    } finally {
      setFeishuLoading(false);
    }
  }, [feishuAuth.authenticated, feishuDriveScope]);

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

  useEffect(() => {
    if (feishuAuth.authenticated) {
      const folderToken = feishuDriveScope === "shared"
        ? (feishuFolderStack.length > 0
          ? feishuFolderStack[feishuFolderStack.length - 1]?.token
          : feishuSharedRootToken)
        : (feishuFolderStack.length > 0 ? feishuFolderStack[feishuFolderStack.length - 1]?.token : "");
      if (open) {
        loadFeishuDriveItems({ scope: feishuDriveScope, folderToken: folderToken || "" });
      }
    } else {
      setFeishuDriveItems([]);
      setFeishuSearchResults([]);
      setFeishuDriveMode("folder");
      setFeishuSharedNeedsToken(false);
    }
  }, [feishuAuth.authenticated, feishuDriveScope, feishuFolderStack, feishuSharedRootToken, loadFeishuDriveItems, open]);

  useEffect(() => {
    if (!open) return;
    void loadIngestJobs();
    const timer = window.setInterval(() => {
      void loadIngestJobs();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadIngestJobs, open]);

  const handleImportLocalFile = useCallback(async () => {
    const filePaths = await openFilePicker({ title: "选择文件", multi: true });
    if (!filePaths || filePaths.length === 0) return;
    setLoading(true);
    setStatus(null);
    try {
      let imported = 0;
      let duplicates = 0;
      for (const filePath of filePaths) {
        const result = await importLocalFile(filePath, { collectionId: collectionId || undefined });
        if (result?.duplicate) {
          duplicates += 1;
        } else {
          imported += 1;
        }
      }
      if (duplicates > 0 && imported > 0) {
        setStatus(`已导入 ${imported} 个文件，跳过重复 ${duplicates} 个`);
      } else if (duplicates > 0) {
        setStatus(`已存在 ${duplicates} 个文件，未重复添加`);
      } else {
        setStatus(`已导入 ${imported} 个文件`);
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
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }, [onImported, urlInput]);

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

  const handleSwitchFeishuScope = useCallback((scope: "my" | "shared") => {
    setFeishuDriveScope(scope);
    setFeishuFolderStack([]);
    setFeishuDriveMode("folder");
    setFeishuSearchResults([]);
    if (scope === "my") {
      setFeishuSharedNeedsToken(false);
    }
  }, []);

  const handleApplySharedRoot = useCallback(() => {
    const token = extractFolderToken(feishuSharedFolderInput);
    if (!token) return;
    setFeishuSharedRootToken(token);
    setFeishuFolderStack([]);
    setFeishuDriveMode("folder");
    setFeishuSharedNeedsToken(false);
  }, [extractFolderToken, feishuSharedFolderInput]);

  const handleOpenFeishuFolder = useCallback((item: FeishuDocItem) => {
    if (!item.token) return;
    setFeishuFolderStack((prev) => [...prev, { token: item.token, title: item.title || "Untitled" }]);
    setFeishuDriveMode("folder");
  }, []);

  const handleNavigateFeishuPath = useCallback((index: number) => {
    if (index < 0) {
      setFeishuFolderStack([]);
      return;
    }
    setFeishuFolderStack((prev) => prev.slice(0, index + 1));
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
      });
      if (result?.duplicate) {
        setStatus(result?.message || `飞书文档已存在：${doc.title}`);
      } else {
        setStatus(`已导入飞书文档：${doc.title}`);
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
        setStatus(`已导入飞书文件：${doc.title}`);
      }
      onImported?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setLoading(false);
    }
  }, [collectionId, onImported, sessionId]);

  const handleImportAllFeishuDocs = useCallback(async () => {
    const sourceItems = feishuDriveMode === "search"
      ? feishuSearchResults
      : feishuDriveItems.filter((doc) => !doc.isFolder && !doc.isFile);
    if (sourceItems.length === 0) return;
    setLoading(true);
    setStatus(null);
    try {
      let imported = 0;
      let duplicates = 0;
      for (const doc of sourceItems) {
        const result = await importFeishuDoc({
          token: doc.token,
          type: doc.type,
          title: doc.title,
          url: doc.url,
          sessionId: sessionId || undefined,
          collectionId: collectionId || undefined,
        });
        if (result?.duplicate) {
          duplicates += 1;
        } else {
          imported += 1;
        }
      }
      if (duplicates > 0 && imported > 0) {
        setStatus(`已导入 ${imported} 个文档，跳过重复 ${duplicates} 个`);
      } else if (duplicates > 0) {
        setStatus(`已存在 ${duplicates} 个文档，未重复添加`);
      } else {
        setStatus(`已导入 ${imported} 个飞书文档`);
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
      const folderToken = feishuDriveScope === "shared"
        ? (feishuFolderStack.length > 0
          ? feishuFolderStack[feishuFolderStack.length - 1]?.token
          : feishuSharedRootToken)
        : (feishuFolderStack.length > 0 ? feishuFolderStack[feishuFolderStack.length - 1]?.token : "");
      loadFeishuDriveItems({ scope: feishuDriveScope, folderToken: folderToken || "" });
    }
  }, [feishuAuth.authenticated, feishuDriveScope, feishuFolderStack, feishuSharedRootToken, loadFeishuDriveItems]);

  const activeJobs = ingestJobs.filter((job) => job.status === "pending" || job.status === "running");
  const recentJobs = activeJobs.length > 0 ? activeJobs : ingestJobs.slice(0, 3);

  const rootLabel = feishuDriveScope === "shared" ? "共享文件夹" : "我的文件夹";
  const displayedFeishuItems = feishuDriveMode === "search" ? feishuSearchResults : feishuDriveItems;
  const sortedFeishuItems = [...displayedFeishuItems].sort((a, b) => {
    const aFolder = a.isFolder ? 1 : 0;
    const bFolder = b.isFolder ? 1 : 0;
    if (aFolder !== bFolder) return bFolder - aFolder;
    return (a.title || "").localeCompare(b.title || "");
  });

  const getJobStatusLabel = (statusValue: KnowledgeIngestJob["status"]) => {
    if (statusValue === "pending") return "排队中";
    if (statusValue === "running") return "处理中";
    if (statusValue === "completed") return "已完成";
    if (statusValue === "failed") return "失败";
    return "已取消";
  };

  return (
    <div className="inline-flex items-center">
      <Button
        variant="outline"
        className={cn(
          "h-9 rounded-lg border-border bg-background px-3 text-sm font-medium text-foreground shadow-none hover:bg-accent",
          triggerClassName,
        )}
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={Add} className="h-3.5 w-3.5" />
        <span className="ml-1">添加资料</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[96vw] max-w-[1200px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>添加资料</DialogTitle>
            <DialogDescription>选择资料来源并导入到资料库</DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="local">本地</TabsTrigger>
              <TabsTrigger value="url">网页</TabsTrigger>
              <TabsTrigger value="feishu">飞书</TabsTrigger>
            </TabsList>

            <TabsContent value="local" className="space-y-3 pt-2">
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-xs font-medium text-foreground">文件夹导入方式：后台批量入库</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  选择文件夹后会创建可续跑队列，后台逐个解析与索引；应用重启后会继续处理。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handleImportLocalFile} disabled={loading}>
                  选择文件
                </Button>
                <Button size="sm" variant="outline" onClick={handleImportDirectory} disabled={loading}>
                  选择文件夹
                </Button>
              </div>
              {workingDirectory ? (
                <p className="text-[11px] text-muted-foreground">
                  归档目录: {workingDirectory}
                </p>
              ) : null}
            </TabsContent>

            <TabsContent value="url" className="space-y-3 pt-2">
              <div className="flex items-center gap-2">
                <Input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="粘贴网页链接"
                  className="h-9 text-sm"
                />
                <Button size="sm" onClick={handleImportUrl} disabled={loading || !urlInput.trim()}>
                  导入网页
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="feishu" className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">飞书云盘</p>
                {!feishuAuth.loading && !feishuAuth.authenticated && (
                  <Button size="sm" variant="outline" onClick={handleFeishuLogin}>
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
                <div className="grid grid-cols-[260px,1fr] gap-6">
                  <div className="space-y-3">
                    <div className="rounded-lg border bg-muted/30 p-2">
                      <p className="text-[11px] font-medium text-muted-foreground">空间</p>
                      <div className="mt-2 space-y-1">
                        <button
                          type="button"
                          onClick={() => handleSwitchFeishuScope("my")}
                          className={cn(
                            "w-full rounded-md px-2 py-1 text-left text-xs transition-colors",
                            feishuDriveScope === "my"
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-accent"
                          )}
                        >
                          我的文件夹
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSwitchFeishuScope("shared")}
                          className={cn(
                            "w-full rounded-md px-2 py-1 text-left text-xs transition-colors",
                            feishuDriveScope === "shared"
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-accent"
                          )}
                        >
                          共享文件夹
                        </button>
                      </div>
                    </div>

                    <div className="rounded-lg border bg-muted/30 p-2">
                      <p className="text-[11px] font-medium text-muted-foreground">搜索</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Input
                          value={feishuQuery}
                          onChange={(e) => setFeishuQuery(e.target.value)}
                          placeholder="搜索飞书文档"
                          className="h-8 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              loadFeishuSearchDocs(feishuQuery);
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => loadFeishuSearchDocs(feishuQuery)}
                          disabled={feishuLoading}
                        >
                          搜索
                        </Button>
                      </div>
                      {feishuDriveMode === "search" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-2 h-7 px-2 text-[11px]"
                          onClick={handleClearFeishuSearch}
                        >
                          返回文件夹
                        </Button>
                      )}
                    </div>

                    {feishuDriveScope === "shared" && (feishuSharedNeedsToken || !feishuSharedRootToken) && (
                      <div className="rounded-lg border bg-background p-2">
                        <p className="text-[11px] text-muted-foreground">共享文件夹链接或 Token</p>
                        <div className="mt-2 flex items-center gap-2">
                          <Input
                            value={feishuSharedFolderInput}
                            onChange={(e) => setFeishuSharedFolderInput(e.target.value)}
                            placeholder="粘贴共享文件夹链接"
                            className="h-8 text-xs"
                          />
                          <Button size="sm" onClick={handleApplySharedRoot} disabled={feishuLoading}>
                            打开
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex min-h-[320px] flex-col rounded-lg border bg-background p-3">
                    <div className="flex items-center justify-between gap-2 border-b pb-2">
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
                      {feishuFolderStack.length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => handleNavigateFeishuPath(feishuFolderStack.length - 2)}
                        >
                          返回上级
                        </Button>
                      )}
                    </div>

                    {feishuLoading ? (
                      <p className="mt-3 text-xs text-muted-foreground">加载中...</p>
                    ) : sortedFeishuItems.length === 0 ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {feishuDriveMode === "search" ? "暂无搜索结果" : "此文件夹暂无内容"}
                      </p>
                    ) : (
                      <div className="mt-2 space-y-1 overflow-auto">
                        <div className="flex items-center justify-end pb-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            onClick={handleImportAllFeishuDocs}
                            disabled={loading || feishuDriveMode !== "search"}
                          >
                            导入全部
                          </Button>
                        </div>
                        {sortedFeishuItems.map((doc) => {
                          const isFolder = !!doc.isFolder;
                          const isFile = !!doc.isFile;
                          const typeLabel = isFolder ? "文件夹" : isFile ? "文件" : doc.type;
                          return (
                            <div key={`${doc.type}:${doc.token}`} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50">
                              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted/40">
                                <HugeiconsIcon icon={isFolder ? FolderOpen : File} className="h-3.5 w-3.5 text-muted-foreground" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">{doc.title}</p>
                                <p className="text-[11px] text-muted-foreground">{typeLabel}</p>
                              </div>
                              {isFolder ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => handleOpenFeishuFolder(doc)}
                                  disabled={loading}
                                >
                                  打开
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => (isFile ? handleImportFeishuFile(doc) : handleImportFeishuDoc(doc))}
                                  disabled={loading}
                                >
                                  导入
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          {recentJobs.length > 0 ? (
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">后台入库任务</p>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => void loadIngestJobs()}
                    disabled={loading}
                  >
                    刷新
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-red-600 hover:text-red-700"
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
                  const canRetry = (job.failed_files > 0 || job.skipped_files > 0) && job.status !== "running" && job.status !== "pending";
                  const canCancel = job.status === "pending" || job.status === "running";
                  const canReprocess = job.status !== "pending" && job.status !== "running";
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
                        <span>{isReprocess ? "目录重处理" : "目录入库"}</span>
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

          {status && (
            <div className="text-xs text-muted-foreground">{status}</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
