"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, PencilEdit01Icon, Loading } from "@hugeicons/core-free-icons";
import { useTranslation } from "@/hooks/useTranslation";
import type { WorkflowAgentPreset } from "@/lib/db/workflow-agent-presets";
import { WorkflowAgentPresetDialog } from "./WorkflowAgentPresetDialog";

const ROLE_BADGE: Record<string, string> = {
  worker: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  researcher: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  coder: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  integration: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
};

interface PresetCardProps {
  preset: WorkflowAgentPreset;
  onEdit: (p: WorkflowAgentPreset) => void;
  onDelete: (p: WorkflowAgentPreset) => void;
}

function PresetCard({ preset, onEdit, onDelete }: PresetCardProps) {
  const { t } = useTranslation();
  const roleBadge = preset.config.role ? ROLE_BADGE[preset.config.role] : undefined;

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 p-3 transition-shadow hover:shadow-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{preset.name}</span>
          {preset.category === "builtin" && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              {t("wapSettings.builtin")}
            </Badge>
          )}
          {roleBadge && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${roleBadge}`}>
              {preset.config.role}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{preset.config.expertise}</p>
        {preset.description && (
          <p className="text-xs text-muted-foreground/70 line-clamp-1">{preset.description}</p>
        )}
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/50">
          id: {preset.id}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {preset.category !== "builtin" && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onEdit(preset)}
            >
              <HugeiconsIcon icon={PencilEdit01Icon} className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => onDelete(preset)}
            >
              <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function WorkflowAgentPresetsSection() {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<WorkflowAgentPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkflowAgentPreset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowAgentPreset | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workflow/workflow-agent-presets");
      const data = await res.json() as { presets?: WorkflowAgentPreset[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("wapSettings.errorLoad"));
      setPresets(data.presets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wapSettings.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  function openAdd() {
    setEditTarget(null);
    setDialogOpen(true);
  }

  function openEdit(preset: WorkflowAgentPreset) {
    setEditTarget(preset);
    setDialogOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workflow/workflow-agent-presets/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || t("wapSettings.errorDelete"));
      }
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wapSettings.errorDelete"));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const builtin = presets.filter((p) => p.category === "builtin");
  const custom = presets.filter((p) => p.category === "user");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">{t("wapSettings.title")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("wapSettings.description")}</p>
        </div>
        <Button size="sm" onClick={openAdd} className="shrink-0">
          <HugeiconsIcon icon={Add01Icon} className="mr-1.5 h-3.5 w-3.5" />
          {t("wapSettings.addPreset")}
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HugeiconsIcon icon={Loading} className="h-4 w-4 animate-spin" />
          {t("wapSettings.loading")}
        </div>
      )}

      {error && !loading && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {!loading && (
        <>
          {builtin.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("wapSettings.builtin")}
              </h3>
              {builtin.map((p) => (
                <PresetCard key={p.id} preset={p} onEdit={openEdit} onDelete={setDeleteTarget} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t("wapSettings.custom")}
            </h3>
            {custom.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("wapSettings.noCustomPresets")}</p>
            ) : (
              custom.map((p) => (
                <PresetCard key={p.id} preset={p} onEdit={openEdit} onDelete={setDeleteTarget} />
              ))
            )}
          </div>
        </>
      )}

      <WorkflowAgentPresetDialog
        open={dialogOpen}
        preset={editTarget}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("wapSettings.deleteConfirm").replace("{name}", deleteTarget?.name ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("wapSettings.deleteConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("wapSettings.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {t("wapSettings.deletePreset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
