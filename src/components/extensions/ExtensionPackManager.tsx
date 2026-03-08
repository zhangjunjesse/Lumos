"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp01,
  ArrowDown01,
  Loading,
  AlertCircle,
  CheckmarkCircle02Icon,
  FolderOpen,
  Search,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";

type ConflictStrategy = "skip" | "replace" | "rename";
type ExportScope = "builtin" | "user";

interface ExportSelectableItem {
  name: string;
  scope: ExportScope;
  description: string;
  isEnabled: boolean;
}

interface ImportPreviewData {
  totalSkills: number;
  totalMcpServers: number;
  newSkills: number;
  newMcpServers: number;
  conflictSkills: string[];
  conflictMcpServers: string[];
  invalidSkills: string[];
  invalidMcpServers: string[];
}

interface ImportResultData {
  skills: {
    created: number;
    replaced: number;
    renamed: number;
    skipped: number;
    failed: number;
  };
  mcpServers: {
    created: number;
    replaced: number;
    renamed: number;
    skipped: number;
    failed: number;
  };
  messages: string[];
}

interface ExtensionPackManagerProps {
  onImported?: () => void;
}

function getSelectionKey(scope: ExportScope, name: string): string {
  return `${scope}:${name}`;
}

function parseSelectionKey(key: string): { scope: ExportScope; name: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;

  const scopeRaw = key.slice(0, separator);
  const name = key.slice(separator + 1);
  if (!name) return null;
  if (scopeRaw !== "builtin" && scopeRaw !== "user") return null;
  return {
    scope: scopeRaw,
    name,
  };
}

function dateStamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${y}${m}${d}-${hh}${mm}`;
}

export function ExtensionPackManager({ onImported }: ExtensionPackManagerProps) {
  const { t } = useTranslation();

  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [exportSearch, setExportSearch] = useState("");
  const [availableSkills, setAvailableSkills] = useState<ExportSelectableItem[]>([]);
  const [availableMcpServers, setAvailableMcpServers] = useState<ExportSelectableItem[]>([]);
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<string[]>([]);
  const [selectedMcpKeys, setSelectedMcpKeys] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportSummary, setExportSummary] = useState<{
    skills: number;
    mcpServers: number;
    redactedEnvKeys: number;
    redactedHeaderKeys: number;
  } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [rawPack, setRawPack] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreviewData | null>(null);
  const [importResult, setImportResult] = useState<ImportResultData | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<ConflictStrategy>("rename");
  const [showDetailList, setShowDetailList] = useState(false);
  const [showImportMessages, setShowImportMessages] = useState(false);

  const conflictCount = useMemo(() => {
    if (!preview) return 0;
    return preview.conflictSkills.length + preview.conflictMcpServers.length;
  }, [preview]);

  const invalidCount = useMemo(() => {
    if (!preview) return 0;
    return preview.invalidSkills.length + preview.invalidMcpServers.length;
  }, [preview]);

  const normalizedExportSearch = useMemo(() => exportSearch.trim().toLowerCase(), [exportSearch]);

  const filteredSkillsForSelection = useMemo(() => {
    return availableSkills.filter((item) => (
      !normalizedExportSearch ||
      item.name.toLowerCase().includes(normalizedExportSearch) ||
      item.description.toLowerCase().includes(normalizedExportSearch)
    ));
  }, [availableSkills, normalizedExportSearch]);

  const filteredMcpForSelection = useMemo(() => {
    return availableMcpServers.filter((item) => (
      !normalizedExportSearch ||
      item.name.toLowerCase().includes(normalizedExportSearch) ||
      item.description.toLowerCase().includes(normalizedExportSearch)
    ));
  }, [availableMcpServers, normalizedExportSearch]);

  const loadExportTargets = useCallback(async () => {
    setSelectionLoading(true);
    setSelectionError(null);
    try {
      const [skillsRes, mcpRes] = await Promise.all([
        fetch("/api/skills"),
        fetch("/api/plugins/mcp"),
      ]);
      const [skillsData, mcpData] = await Promise.all([skillsRes.json(), mcpRes.json()]);

      if (!skillsRes.ok || !mcpRes.ok) {
        const reason =
          skillsData?.error ||
          mcpData?.error ||
          t("extensions.packSelectionLoadFailed");
        setSelectionError(reason);
        return;
      }

      const scopeOrder = (scope: ExportScope) => (scope === "user" ? 0 : 1);
      const sortFn = (a: ExportSelectableItem, b: ExportSelectableItem) => {
        const scopeDiff = scopeOrder(a.scope) - scopeOrder(b.scope);
        if (scopeDiff !== 0) return scopeDiff;
        return a.name.localeCompare(b.name);
      };

      const skills: ExportSelectableItem[] = Array.isArray(skillsData?.skills)
        ? skillsData.skills
            .map((entry: unknown) => {
              const item = entry as {
                name?: string;
                scope?: string;
                description?: string;
                is_enabled?: boolean;
              };
              if (!item?.name) return null;
              const scope: ExportScope = item.scope === "builtin" ? "builtin" : "user";
              return {
                name: item.name,
                scope,
                description: String(item.description ?? ""),
                isEnabled: item.is_enabled !== false,
              };
            })
            .filter((item: ExportSelectableItem | null): item is ExportSelectableItem => item !== null)
            .sort(sortFn)
        : [];

      const mcpRaw = mcpData?.mcpServers;
      const mcpServers: ExportSelectableItem[] = mcpRaw && typeof mcpRaw === "object"
        ? Object.entries(mcpRaw as Record<string, unknown>)
            .map(([name, entry]) => {
              const item = entry as {
                scope?: string;
                description?: string;
                is_enabled?: boolean;
              };
              const scope: ExportScope = item.scope === "builtin" ? "builtin" : "user";
              return {
                name,
                scope,
                description: String(item.description ?? ""),
                isEnabled: item.is_enabled !== false,
              };
            })
            .sort(sortFn)
        : [];

      setAvailableSkills(skills);
      setAvailableMcpServers(mcpServers);

      setSelectedSkillKeys(skills.map((item) => getSelectionKey(item.scope, item.name)));
      setSelectedMcpKeys(mcpServers.map((item) => getSelectionKey(item.scope, item.name)));
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : t("extensions.packSelectionLoadFailed"));
    } finally {
      setSelectionLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!exportOpen) return;
    void loadExportTargets();
  }, [exportOpen, loadExportTargets]);

  const toggleSkillSelection = (key: string) => {
    setSelectedSkillKeys((prev) => (
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    ));
  };

  const toggleMcpSelection = (key: string) => {
    setSelectedMcpKeys((prev) => (
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    ));
  };

  const addVisibleSkills = () => {
    const visibleKeys = filteredSkillsForSelection.map((item) => getSelectionKey(item.scope, item.name));
    if (visibleKeys.length === 0) return;
    setSelectedSkillKeys((prev) => Array.from(new Set([...prev, ...visibleKeys])));
  };

  const clearVisibleSkills = () => {
    const visibleSet = new Set(filteredSkillsForSelection.map((item) => getSelectionKey(item.scope, item.name)));
    if (visibleSet.size === 0) return;
    setSelectedSkillKeys((prev) => prev.filter((key) => !visibleSet.has(key)));
  };

  const addVisibleMcpServers = () => {
    const visibleKeys = filteredMcpForSelection.map((item) => getSelectionKey(item.scope, item.name));
    if (visibleKeys.length === 0) return;
    setSelectedMcpKeys((prev) => Array.from(new Set([...prev, ...visibleKeys])));
  };

  const clearVisibleMcpServers = () => {
    const visibleSet = new Set(filteredMcpForSelection.map((item) => getSelectionKey(item.scope, item.name)));
    if (visibleSet.size === 0) return;
    setSelectedMcpKeys((prev) => prev.filter((key) => !visibleSet.has(key)));
  };

  const selectAllExportItems = () => {
    setSelectedSkillKeys(availableSkills.map((item) => getSelectionKey(item.scope, item.name)));
    setSelectedMcpKeys(availableMcpServers.map((item) => getSelectionKey(item.scope, item.name)));
  };

  const clearAllExportItems = () => {
    setSelectedSkillKeys([]);
    setSelectedMcpKeys([]);
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    setExportSummary(null);
    try {
      const selectedSkills = selectedSkillKeys
        .map((key) => parseSelectionKey(key))
        .filter((item): item is { scope: ExportScope; name: string } => item !== null);
      const selectedMcpServers = selectedMcpKeys
        .map((key) => parseSelectionKey(key))
        .filter((item): item is { scope: ExportScope; name: string } => item !== null);
      const selectedTotal = selectedSkills.length + selectedMcpServers.length;
      if (selectedTotal === 0) {
        setExportError(t("extensions.packSelectItems"));
        return;
      }

      const res = await fetch("/api/extensions/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "export",
          options: {
            mode: "selected",
            includeSkills: true,
            includeMcpServers: true,
            includeBuiltin: true,
            includeDisabled: true,
            selectedSkills,
            selectedMcpServers,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setExportError(data?.error || t("extensions.packExportFailed"));
        return;
      }

      const json = JSON.stringify(data.pack, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lumos-pack-${dateStamp()}.lumos-pack.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setExportSummary(data.summary || null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : t("extensions.packExportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const parseFileAndPreview = async (file: File) => {
    setImportError(null);
    setImportResult(null);
    setPreview(null);
    setShowDetailList(false);
    setShowImportMessages(false);
    setPreviewLoading(true);
    setSelectedFileName(file.name);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setRawPack(parsed);

      const res = await fetch("/api/extensions/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview-import",
          pack: parsed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data?.error || t("extensions.packImportPreviewFailed"));
        return;
      }
      setPreview(data.preview || null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t("extensions.packInvalidFile"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleApplyImport = async () => {
    if (!rawPack) {
      setImportError(t("extensions.packImportChooseFile"));
      return;
    }

    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/extensions/pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply-import",
          pack: rawPack,
          conflictStrategy: strategy,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data?.error || t("extensions.packImportFailed"));
        return;
      }

      setImportResult(data.result || null);
      setShowImportMessages((data.result?.messages?.length || 0) > 0);
      onImported?.();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t("extensions.packImportFailed"));
    } finally {
      setImporting(false);
    }
  };

  const resetImportState = () => {
    setSelectedFileName("");
    setRawPack(null);
    setPreview(null);
    setImportResult(null);
    setImportError(null);
    setPreviewLoading(false);
    setImporting(false);
    setStrategy("rename");
    setShowDetailList(false);
    setShowImportMessages(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setExportOpen(true)}>
        <HugeiconsIcon icon={ArrowDown01} className="h-3.5 w-3.5" />
        {t("extensions.packExport")}
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
        <HugeiconsIcon icon={ArrowUp01} className="h-3.5 w-3.5" />
        {t("extensions.packImport")}
      </Button>

      <Dialog
        open={exportOpen}
        onOpenChange={(open) => {
          setExportOpen(open);
          if (!open) {
            setExportError(null);
            setExportSummary(null);
            setExportSearch("");
          }
        }}
      >
        <DialogContent className="w-[94vw] max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t("extensions.packExportTitle")}</DialogTitle>
            <DialogDescription>{t("extensions.packExportDesc")}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[74vh] space-y-3 overflow-y-auto pr-1">
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{t("extensions.packSelectItemsTitle")}</p>
                <Badge variant="secondary">
                  {t("extensions.packSelectionCount")}: {selectedSkillKeys.length + selectedMcpKeys.length}
                </Badge>
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={selectAllExportItems}>
                  {t("extensions.packSelectAll")}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={clearAllExportItems}>
                  {t("extensions.packClearAll")}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void loadExportTargets()}>
                  {t("extensions.packRefreshTargets")}
                </Button>
              </div>

              <div className="relative mb-2">
                <HugeiconsIcon icon={Search} className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={exportSearch}
                  onChange={(event) => setExportSearch(event.target.value)}
                  placeholder={t("extensions.packSelectionSearchPlaceholder")}
                  className="h-8 pl-7 text-xs"
                />
              </div>

              {selectionLoading && (
                <div className="mb-2 flex items-center gap-2 rounded border bg-muted/30 p-2 text-xs text-muted-foreground">
                  <HugeiconsIcon icon={Loading} className="h-3.5 w-3.5 animate-spin" />
                  {t("extensions.packSelectionLoading")}
                </div>
              )}

              {selectionError && (
                <p className="mb-2 text-xs text-destructive">{selectionError}</p>
              )}

              {!selectionLoading && !selectionError && (
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  <ExportSelectionBlock
                    title={t("extensions.packSummarySkills")}
                    items={filteredSkillsForSelection}
                    selectedKeys={selectedSkillKeys}
                    onToggle={toggleSkillSelection}
                    onSelectAll={addVisibleSkills}
                    onClear={clearVisibleSkills}
                    selectAllLabel={t("extensions.packSelectionSelectAllVisible")}
                    clearLabel={t("extensions.packSelectionClearVisible")}
                    scopeBuiltinLabel={t("extensions.packScopeBuiltin")}
                    scopeUserLabel={t("extensions.packScopeUser")}
                    noItemsLabel={t("extensions.packSelectionEmpty")}
                    disabledLabel={t("common.disabled")}
                  />
                  <ExportSelectionBlock
                    title={t("extensions.packSummaryMcp")}
                    items={filteredMcpForSelection}
                    selectedKeys={selectedMcpKeys}
                    onToggle={toggleMcpSelection}
                    onSelectAll={addVisibleMcpServers}
                    onClear={clearVisibleMcpServers}
                    selectAllLabel={t("extensions.packSelectionSelectAllVisible")}
                    clearLabel={t("extensions.packSelectionClearVisible")}
                    scopeBuiltinLabel={t("extensions.packScopeBuiltin")}
                    scopeUserLabel={t("extensions.packScopeUser")}
                    noItemsLabel={t("extensions.packSelectionEmpty")}
                    disabledLabel={t("common.disabled")}
                  />
                </div>
              )}
            </div>

            {exportError && (
              <p className="text-sm text-destructive">{exportError}</p>
            )}

            {exportSummary && (
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p>{t("extensions.packSummarySkills")}: {exportSummary.skills}</p>
                <p>{t("extensions.packSummaryMcp")}: {exportSummary.mcpServers}</p>
                <p>{t("extensions.packSummaryRedactedEnv")}: {exportSummary.redactedEnvKeys}</p>
                <p>{t("extensions.packSummaryRedactedHeaders")}: {exportSummary.redactedHeaderKeys}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting && <HugeiconsIcon icon={Loading} className="mr-2 h-4 w-4 animate-spin" />}
              {t("extensions.packExportBatch")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) {
            resetImportState();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("extensions.packImportTitle")}</DialogTitle>
            <DialogDescription>{t("extensions.packImportDesc")}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.lumos-pack,.lumos-pack.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void parseFileAndPreview(file);
                }
              }}
            />

            <button
              type="button"
              onClick={handlePickFile}
              className="group w-full rounded-lg border border-dashed bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t("extensions.packImportChooseFile")}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedFileName || t("extensions.packImportNoFile")}
                  </p>
                </div>
                <span className="inline-flex items-center rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground/80 shadow-sm transition-colors group-hover:border-primary/40 group-hover:text-primary">
                  <HugeiconsIcon icon={FolderOpen} className="mr-1.5 h-3.5 w-3.5" />
                  {t("extensions.packImportChoose")}
                </span>
              </div>
            </button>

            {previewLoading && (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                <HugeiconsIcon icon={Loading} className="h-4 w-4 animate-spin" />
                {t("extensions.packPreviewing")}
              </div>
            )}

            {preview && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <SummaryCard
                  label={t("extensions.packSummarySkills")}
                  value={`${preview.totalSkills}`}
                  extra={`${t("extensions.packSummaryNew")}: ${preview.newSkills}`}
                />
                <SummaryCard
                  label={t("extensions.packSummaryMcp")}
                  value={`${preview.totalMcpServers}`}
                  extra={`${t("extensions.packSummaryNew")}: ${preview.newMcpServers}`}
                />
                <SummaryCard
                  label={t("extensions.packSummaryConflicts")}
                  value={`${preview.conflictSkills.length + preview.conflictMcpServers.length}`}
                  extra={`${t("extensions.packSummaryInvalid")}: ${
                    preview.invalidSkills.length + preview.invalidMcpServers.length
                  }`}
                />
              </div>
            )}

            {preview && (conflictCount > 0 || invalidCount > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <div className="mb-2 flex flex-wrap items-center gap-2 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <HugeiconsIcon icon={AlertCircle} className="h-3.5 w-3.5" />
                    {t("extensions.packConflictStrategy")}
                  </span>
                  <Badge variant="secondary" className="h-5 text-[10px]">
                    {t("extensions.packSummaryConflicts")}: {conflictCount}
                  </Badge>
                  <Badge variant="secondary" className="h-5 text-[10px]">
                    {t("extensions.packSummaryInvalid")}: {invalidCount}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StrategyButton
                    active={strategy === "rename"}
                    label={t("extensions.packStrategyRename")}
                    onClick={() => setStrategy("rename")}
                  />
                  <StrategyButton
                    active={strategy === "replace"}
                    label={t("extensions.packStrategyReplace")}
                    onClick={() => setStrategy("replace")}
                  />
                  <StrategyButton
                    active={strategy === "skip"}
                    label={t("extensions.packStrategySkip")}
                    onClick={() => setStrategy("skip")}
                  />
                  <button
                    type="button"
                    className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted/60"
                    onClick={() => setShowDetailList((value) => !value)}
                  >
                    {showDetailList ? t("extensions.packHideDetails") : t("extensions.packShowDetails")}
                  </button>
                </div>

                {showDetailList && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <NameListBlock
                      title={t("extensions.packConflictSkills")}
                      values={preview.conflictSkills}
                      emptyLabel={t("extensions.packNoItems")}
                    />
                    <NameListBlock
                      title={t("extensions.packConflictMcp")}
                      values={preview.conflictMcpServers}
                      emptyLabel={t("extensions.packNoItems")}
                    />
                    <NameListBlock
                      title={t("extensions.packInvalidSkills")}
                      values={preview.invalidSkills}
                      emptyLabel={t("extensions.packNoItems")}
                    />
                    <NameListBlock
                      title={t("extensions.packInvalidMcp")}
                      values={preview.invalidMcpServers}
                      emptyLabel={t("extensions.packNoItems")}
                    />
                  </div>
                )}
              </div>
            )}

            {importResult && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                <div className="mb-2 flex items-center gap-1.5 font-medium">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} className="h-3.5 w-3.5" />
                  {t("extensions.packImportDone")}
                </div>
                <div className="space-y-1">
                  <p>
                    {t("extensions.packSummarySkills")}: +{importResult.skills.created}
                    /~{importResult.skills.replaced}/{t("extensions.packStrategyRename")} {importResult.skills.renamed}/{t("extensions.packStrategySkip")} {importResult.skills.skipped}
                  </p>
                  <p>
                    {t("extensions.packSummaryMcp")}: +{importResult.mcpServers.created}
                    /~{importResult.mcpServers.replaced}/{t("extensions.packStrategyRename")} {importResult.mcpServers.renamed}/{t("extensions.packStrategySkip")} {importResult.mcpServers.skipped}
                  </p>
                </div>
                {(importResult.skills.failed > 0 || importResult.mcpServers.failed > 0) && (
                  <p className="text-destructive">
                    {t("extensions.packSummaryFailed")}: {importResult.skills.failed + importResult.mcpServers.failed}
                  </p>
                )}
                {importResult.messages.length > 0 && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="rounded-md border border-emerald-300/70 px-2 py-1 text-xs transition-colors hover:bg-emerald-100 dark:border-emerald-700 dark:hover:bg-emerald-900/40"
                      onClick={() => setShowImportMessages((value) => !value)}
                    >
                      {showImportMessages ? t("extensions.packHideDetails") : t("extensions.packShowMessages")}
                    </button>
                    {showImportMessages && (
                      <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded border border-emerald-200/70 bg-white/60 p-2 text-[11px] dark:border-emerald-800 dark:bg-emerald-950/40">
                        {importResult.messages.map((message, index) => (
                          <li key={`${message}-${index}`} className="leading-relaxed">
                            {message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}

            {importError && (
              <p className="text-sm text-destructive">{importError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setImportOpen(false);
                resetImportState();
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleApplyImport}
              disabled={importing || previewLoading || !rawPack}
            >
              {importing && <HugeiconsIcon icon={Loading} className="mr-2 h-4 w-4 animate-spin" />}
              <HugeiconsIcon icon={ArrowUp01} className="mr-1.5 h-4 w-4" />
              {t("extensions.packImportApply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExportSelectionBlock({
  title,
  items,
  selectedKeys,
  onToggle,
  onSelectAll,
  onClear,
  selectAllLabel,
  clearLabel,
  scopeBuiltinLabel,
  scopeUserLabel,
  noItemsLabel,
  disabledLabel,
}: {
  title: string;
  items: ExportSelectableItem[];
  selectedKeys: string[];
  onToggle: (key: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  selectAllLabel: string;
  clearLabel: string;
  scopeBuiltinLabel: string;
  scopeUserLabel: string;
  noItemsLabel: string;
  disabledLabel: string;
}) {
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  return (
    <div className="rounded-md border bg-muted/20 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium">
          {title} ({items.length})
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60"
            onClick={onSelectAll}
          >
            {selectAllLabel}
          </button>
          <button
            type="button"
            className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60"
            onClick={onClear}
          >
            {clearLabel}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{noItemsLabel}</p>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {items.map((item) => {
            const key = getSelectionKey(item.scope, item.name);
            const checked = selectedSet.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onToggle(key)}
                className={cn(
                  "w-full rounded border px-2 py-1.5 text-left transition-colors",
                  checked ? "border-primary/40 bg-primary/5" : "hover:bg-muted/40"
                )}
              >
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[10px]",
                      checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                    )}
                  >
                    {checked ? "✓" : ""}
                  </span>
                  <span className="truncate text-xs font-medium">{item.name}</span>
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {item.scope === "builtin" ? scopeBuiltinLabel : scopeUserLabel}
                  </Badge>
                  {!item.isEnabled && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      {disabledLabel}
                    </Badge>
                  )}
                </div>
                {item.description && (
                  <p className="line-clamp-1 text-[11px] text-muted-foreground">{item.description}</p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StrategyButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 text-xs transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted/50"
      )}
    >
      {label}
    </button>
  );
}

function SummaryCard({
  label,
  value,
  extra,
}: {
  label: string;
  value: string;
  extra: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold leading-tight">{value}</p>
      <p className="text-[11px] text-muted-foreground">{extra}</p>
    </div>
  );
}

function NameListBlock({
  title,
  values,
  emptyLabel,
}: {
  title: string;
  values: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-md border border-amber-300/60 bg-amber-100/40 p-2 dark:border-amber-700 dark:bg-amber-900/20">
      <p className="mb-1 text-[11px] font-medium">{title} ({values.length})</p>
      {values.length === 0 ? (
        <p className="text-[11px] opacity-75">{emptyLabel}</p>
      ) : (
        <ul className="max-h-24 space-y-1 overflow-y-auto pr-1 text-[11px]">
          {values.map((value, index) => (
            <li key={`${title}-${value}-${index}`} className="rounded bg-white/60 px-1.5 py-0.5 dark:bg-amber-950/30">
              {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
